import {
  bufferConnectionsTable,
  platformConnectionsTable,
  type BufferConnection
} from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import type { PublishingDb } from '../connection'
import {
  ConnectionError,
  PlatformApiError,
  PlatformOAuthError
} from '../errors'
import type { BufferConfig, FetchFn, TokenSet } from '../provider'
import {
  decryptToken,
  encryptToken,
  TokenDecryptionError
} from '../token-crypto'
import { refreshAccessToken } from './oauth'

/**
 * The tokens of a user's Buffer connection (buffer_connections): encrypting
 * them for storage, and handing out an access token that still works,
 * refreshed first when it has run out.
 *
 * Buffer's refresh tokens are single-use: every refresh returns a new one and
 * invalidates the one sent, and sending a spent one again revokes the whole
 * grant (https://developers.buffer.com/guides/authentication.html). So a
 * refresh runs inside a transaction holding the connection's row lock: a
 * second process (another worker, or Publish now) waits, then finds the new
 * access token and uses it instead of refreshing again. The new access and
 * refresh tokens replace the old ones in that same transaction.
 *
 * Tokens are AES-256-GCM encrypted with the Buffer token key, bound to the
 * owner's user id; nothing here logs a token. No `server-only` import, so
 * tests can run it against any database.
 */

/** A token closer than this to expiring is refreshed first. */
const EXPIRY_MARGIN_MS = 60_000

const MESSAGES = {
  notConnected: 'Connect Buffer in Settings to publish.',
  expired:
    'Your Buffer connection has expired or was revoked. Reconnect Buffer in Settings.',
  unreadable:
    'The saved Buffer connection can no longer be read. Reconnect Buffer in Settings.',
  unavailable:
    'The Buffer connection could not be renewed just now. It will be tried again.'
} as const

/** The key Buffer tokens are encrypted with. */
export const bufferTokenKey = (
  config: Pick<BufferConfig, 'encryptionKey' | 'tokenEncryptionKey'>
) => config.tokenEncryptionKey ?? config.encryptionKey

export const encryptBufferToken = (
  config: Pick<BufferConfig, 'encryptionKey' | 'tokenEncryptionKey'>,
  userId: string,
  value: string
) => encryptToken(value, bufferTokenKey(config), userId)

const decryptBufferToken = (
  config: Pick<BufferConfig, 'encryptionKey' | 'tokenEncryptionKey'>,
  userId: string,
  value: string
) => decryptToken(value, bufferTokenKey(config), userId)

/** The token columns for a fresh grant (connect or refresh), encrypted. */
export function tokenColumns(
  config: Pick<BufferConfig, 'encryptionKey' | 'tokenEncryptionKey'>,
  userId: string,
  tokens: Pick<
    TokenSet,
    'accessToken' | 'accessTokenExpiresAt' | 'refreshToken'
  >
) {
  return {
    accessToken: encryptBufferToken(config, userId, tokens.accessToken),
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshToken: tokens.refreshToken
      ? encryptBufferToken(config, userId, tokens.refreshToken)
      : null
  }
}

/** The user's Buffer connection, in any state; null when they never connected one. */
export async function getBufferConnection(
  database: PublishingDb,
  userId: string
): Promise<BufferConnection | null> {
  const [row] = await database
    .select()
    .from(bufferConnectionsTable)
    .where(eq(bufferConnectionsTable.userId, userId))
    .limit(1)
  return row ?? null
}

/**
 * Marks the Buffer connection expired, and with it every network connection
 * publishing through it, so Settings and the Publish controls say Reconnect.
 * Only while it still holds `failedAccessToken` (as stored, encrypted) when
 * that is given: a reconnect or refresh in the meantime is left alone.
 */
export async function markBufferExpired(
  database: PublishingDb,
  connectionId: string,
  failedAccessToken: string | null,
  message: string,
  now = new Date()
): Promise<boolean> {
  return database.transaction(async tx => {
    const [row] = await tx
      .update(bufferConnectionsTable)
      .set({ status: 'expired', lastError: message, updatedAt: now })
      .where(
        and(
          eq(bufferConnectionsTable.id, connectionId),
          eq(bufferConnectionsTable.status, 'connected'),
          failedAccessToken === null
            ? undefined
            : eq(bufferConnectionsTable.accessToken, failedAccessToken)
        )
      )
      .returning({ id: bufferConnectionsTable.id })
    if (!row) return false
    await tx
      .update(platformConnectionsTable)
      .set({ status: 'expired', lastError: message, updatedAt: now })
      .where(
        and(
          eq(platformConnectionsTable.bufferConnectionId, connectionId),
          eq(platformConnectionsTable.status, 'connected')
        )
      )
    return true
  })
}

/** Inside the refresh: Buffer cannot be asked (no refresh token or app client). */
class RefreshImpossible extends Error {}

const isFresh = (
  row: Pick<BufferConnection, 'accessTokenExpiresAt'>,
  now: Date
) =>
  (row.accessTokenExpiresAt?.getTime() ?? Infinity) - EXPIRY_MARGIN_MS >
  now.getTime()

/**
 * A decrypted access token for the user's Buffer connection that still
 * works, and the stored (encrypted) value it came from, which a later 401
 * passes to markBufferExpired. Refreshes first when the token has run out or
 * is about to, one process at a time (see above). Marks the connection
 * expired when its token cannot be read, has run out with nothing to refresh
 * it with, or Buffer refused the refresh; an outage (network, Buffer's 5xx,
 * our database) throws a retryable PlatformApiError and changes nothing.
 */
export async function usableBufferToken(
  database: PublishingDb,
  config: BufferConfig,
  owner: { connectionId: string; userId: string },
  fetchFn: FetchFn = fetch,
  now = new Date()
): Promise<{ accessToken: string; stored: string }> {
  const load = async (row: BufferConnection | undefined | null) => {
    // Never another user's connection, whatever id was passed.
    if (
      !row ||
      row.userId !== owner.userId ||
      row.status === 'disconnected' ||
      !row.accessToken
    ) {
      throw new ConnectionError(MESSAGES.notConnected, 'not_connected')
    }
    if (row.status === 'expired') {
      throw new ConnectionError(
        row.lastError ?? MESSAGES.expired,
        'reauth_required'
      )
    }
    return row as BufferConnection & { accessToken: string }
  }
  const [initial] = await database
    .select()
    .from(bufferConnectionsTable)
    .where(eq(bufferConnectionsTable.id, owner.connectionId))
    .limit(1)
  const connection = await load(initial)
  // Marks expired whichever token was in use when it failed.
  let failing = connection.accessToken
  const expire = async (message: string) => {
    await markBufferExpired(database, connection.id, failing, message, now)
    return new ConnectionError(message, 'reauth_required')
  }
  const decrypt = (value: string) =>
    decryptBufferToken(config, owner.userId, value)

  if (isFresh(connection, now)) {
    try {
      return {
        accessToken: decrypt(connection.accessToken),
        stored: connection.accessToken
      }
    } catch (err) {
      if (err instanceof TokenDecryptionError)
        throw await expire(MESSAGES.unreadable)
      throw err
    }
  }

  try {
    return await database.transaction(async tx => {
      const [locked] = await tx
        .select()
        .from(bufferConnectionsTable)
        .where(eq(bufferConnectionsTable.id, connection.id))
        .for('update')
      const current = await load(locked)
      failing = current.accessToken
      // Refreshed (or reconnected) by another process while this one waited.
      if (isFresh(current, now)) {
        return {
          accessToken: decrypt(current.accessToken),
          stored: current.accessToken
        }
      }
      if (!current.refreshToken || !config.oauth) {
        throw new RefreshImpossible(MESSAGES.expired)
      }
      const tokens = await refreshAccessToken(
        config.oauth,
        decrypt(current.refreshToken),
        fetchFn,
        now.getTime()
      )
      const columns = tokenColumns(config, owner.userId, {
        ...tokens,
        // Buffer always sends a new one; should it not, the old one is spent anyway.
        refreshToken: tokens.refreshToken
      })
      await tx
        .update(bufferConnectionsTable)
        .set({ ...columns, scopes: tokens.scopes, updatedAt: now })
        .where(eq(bufferConnectionsTable.id, current.id))
      return { accessToken: tokens.accessToken, stored: columns.accessToken }
    })
  } catch (err) {
    if (err instanceof ConnectionError) throw err
    if (err instanceof RefreshImpossible) throw await expire(err.message)
    if (err instanceof TokenDecryptionError)
      throw await expire(MESSAGES.unreadable)
    // Buffer said no: the refresh token was revoked, spent or ran out.
    if (
      err instanceof PlatformOAuthError &&
      (err.status === 400 || err.status === 401)
    ) {
      console.warn(
        `Buffer refused to renew connection ${connection.id} (HTTP ${err.status}); marked expired.`
      )
      throw await expire(MESSAGES.expired)
    }
    // Only the error's own text: never the request, which holds the token.
    console.error(
      `Could not renew Buffer connection ${connection.id}:`,
      err instanceof Error ? err.message : err
    )
    throw new PlatformApiError(MESSAGES.unavailable, 'platform_unavailable')
  }
}
