import { platformConnectionsTable, type PlatformConnection } from '@/db/schema'
import { DEFAULT_PLATFORM_ID, getPlatform, type PlatformId } from '@/lib/platforms'
import { and, eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import {
  type AccountInfo,
  type BufferConfig,
  type FetchFn,
  PlatformApiError,
  type PlatformConfig,
  PlatformOAuthError,
  providerFor
} from './provider'
import { markBufferExpired, usableBufferToken } from './buffer/token'
import { ConnectionError } from './errors'
import { cancelPendingPublications } from './publication-queries'
import {
  decryptToken,
  encryptToken,
  TokenDecryptionError
} from './token-crypto'

/**
 * A user's publishing connection to a platform (a channel of their Buffer
 * account, linked by ./buffer/connection.ts): removing it, switching its
 * account, and handing out a credential that still works. One per user and platform. Always looked up by the
 * signed-in user's id, never by an id from a request, so one user can never
 * reach another's connection.
 *
 * Takes the database as an argument so tests can run it on any connection.
 * Every function takes the platform last, defaulting to LinkedIn (the one
 * platform there was before X).
 */

export type PublishingDb = PgDatabase<PostgresJsQueryResultHKT, any, any>

/** A token closer than this to expiring is treated as expired. */
const EXPIRY_MARGIN_MS = 60_000

export { ConnectionError }

/** What the user is told, in the platform's name. */
function messagesFor(platform: string) {
  const name = getPlatform(platform).name
  return {
    name,
    notConnected: `Connect ${name} in Settings to publish.`,
    expired: `Your ${name} connection has expired. Reconnect ${name} in Settings.`,
    noPermission: `${name} did not grant permission to publish. Reconnect ${name} and allow posting.`,
    unreadable: `The saved ${name} connection can no longer be read. Reconnect ${name} in Settings.`
  }
}

/** Whether the connection's grant includes posting (a key always does). */
const canPublish = (
  connection: Pick<PlatformConnection, 'scopes' | 'platform'>
) => {
  const scope = providerFor(connection.platform).publishScope
  return scope === null || connection.scopes.includes(scope)
}

/**
 * Throws a ConnectionError unless the connection is there, working and
 * allowed to post. `platform` names it in the message when there is none.
 * Its credential is its own token, or (bufferConnectionId) its owner's
 * Buffer connection's, which usableAccessToken checks.
 */
export function assertCanPublish(
  connection: PlatformConnection | null,
  platform: PlatformId = connection?.platform ?? DEFAULT_PLATFORM_ID
): asserts connection is PlatformConnection {
  const say = messagesFor(platform)
  if (
    !connection ||
    connection.status === 'disconnected' ||
    (!connection.accessToken && !connection.bufferConnectionId)
  ) {
    throw new ConnectionError(say.notConnected, 'not_connected')
  }
  // A direct LinkedIn connection (before LinkedIn went through Buffer, which
  // migration 0050 disconnects) holds a LinkedIn token Buffer would refuse.
  if (connection.platform === 'linkedin' && !connection.bufferConnectionId) {
    throw new ConnectionError(
      'LinkedIn now publishes through Buffer. Choose your LinkedIn account on the Buffer card in Settings.',
      'not_connected'
    )
  }
  if (connection.status === 'expired') {
    throw new ConnectionError(say.expired, 'reauth_required')
  }
  if (!canPublish(connection)) {
    throw new ConnectionError(say.noPermission, 'missing_permission')
  }
}

/** The identity's connection to `platform`: each identity has its own. */
export async function getConnection(
  database: PublishingDb,
  accountId: string,
  platform: PlatformId = DEFAULT_PLATFORM_ID
): Promise<PlatformConnection | null> {
  const [row] = await database
    .select()
    .from(platformConnectionsTable)
    .where(
      and(
        eq(platformConnectionsTable.accountId, accountId),
        eq(platformConnectionsTable.platform, platform)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * Removes the connection: its credential is deleted, auto-publishing turns
 * off and the platform's posts waiting to be published are cancelled (in
 * flight too, until the post is sent), so connecting again later never
 * publishes something the user had forgotten about. The row stays (as
 * 'disconnected') so earlier publications keep their history. The
 * identity's other platforms, and the user's other identities, are untouched.
 */
export async function disconnect(
  database: PublishingDb,
  accountId: string,
  platform: PlatformId = DEFAULT_PLATFORM_ID,
  now = new Date()
): Promise<{ cancelled: number } | null> {
  return database.transaction(async tx => {
    const [row] = await tx
      .update(platformConnectionsTable)
      .set({
        status: 'disconnected',
        accessToken: null,
        accessTokenExpiresAt: null,
        refreshToken: null,
        refreshTokenExpiresAt: null,
        autoPublish: false,
        autoPublishEnabledAt: null,
        lastError: null,
        updatedAt: now
      })
      .where(
        and(
          eq(platformConnectionsTable.accountId, accountId),
          eq(platformConnectionsTable.platform, platform)
        )
      )
      .returning({ id: platformConnectionsTable.id })
    if (!row) return null
    const cancelled = await cancelPendingPublications(
      tx,
      { accountId, platform },
      {
        message: `Cancelled because ${messagesFor(platform).name} was disconnected.`,
        code: 'not_connected'
      },
      { includeUnsentInFlight: true, now }
    )
    return { cancelled }
  })
}

/**
 * The stored Buffer token each connection through a Buffer connection last
 * got from usableAccessToken, so a 401 from Buffer expires the Buffer
 * connection only while it still holds that token. Keyed by the connection
 * object the engine passes to both.
 */
const bufferTokensInUse = new WeakMap<object, string>()

/**
 * Marks the connection expired, only while it still holds the credential that
 * failed (`accessToken` as stored, encrypted): a reconnect or refresh in the
 * meantime is left alone. One through a Buffer connection expires that Buffer
 * connection, and with it every network publishing through it.
 */
export async function markExpired(
  database: PublishingDb,
  connection: {
    id: string
    accessToken: string | null
    bufferConnectionId?: string | null
  },
  message: string,
  now = new Date()
) {
  if (connection.bufferConnectionId) {
    await markBufferExpired(
      database,
      connection.bufferConnectionId,
      bufferTokensInUse.get(connection) ?? null,
      message,
      now
    )
    return
  }
  if (!connection.accessToken) return
  await database
    .update(platformConnectionsTable)
    .set({ status: 'expired', lastError: message, updatedAt: now })
    .where(
      and(
        eq(platformConnectionsTable.id, connection.id),
        eq(platformConnectionsTable.accessToken, connection.accessToken)
      )
    )
}

/**
 * A decrypted credential that still works, refreshed first when it has run
 * out (or is about to) and the platform gave this app a refresh token. A
 * Buffer API key does not run out. The one place a connection is marked
 * expired (besides a 401 while publishing): when its credential cannot be
 * read, has run out, or the platform refused the refresh. Then the user must
 * connect again. A refresh that failed for any other reason (an outage)
 * throws a retryable PlatformApiError instead.
 *
 * A refresh runs with the connection's row locked, so processes take turns:
 * Buffer's refresh tokens are single-use, and sending one twice (two workers,
 * or a worker and Publish now) would revoke the user's whole grant. The one
 * that waited finds the new token and uses it.
 *
 * A connection through a Buffer connection (bufferConnectionId) uses that
 * connection's token instead, renewed the same way (./buffer/token.ts).
 */
export async function usableAccessToken(
  database: PublishingDb,
  config: PlatformConfig,
  connection: PlatformConnection,
  fetchFn: FetchFn = fetch,
  now = new Date()
): Promise<string> {
  assertCanPublish(connection)
  if (connection.bufferConnectionId) {
    const { accessToken, stored } = await usableBufferToken(
      database,
      config as BufferConfig,
      // The owner's own Buffer connection only.
      { connectionId: connection.bufferConnectionId, userId: connection.userId },
      fetchFn,
      now
    )
    bufferTokensInUse.set(connection, stored)
    return accessToken
  }
  const say = messagesFor(connection.platform)
  const decrypt = (value: string) =>
    decryptToken(value, config.encryptionKey, connection.userId)
  const fresh = (row: PlatformConnection) =>
    (row.accessTokenExpiresAt?.getTime() ?? Infinity) - EXPIRY_MARGIN_MS >
    now.getTime()
  // Marks expired whichever credential was in use when it failed.
  let failing = { id: connection.id, accessToken: connection.accessToken! }
  const expire = async (message: string) => {
    await markExpired(database, failing, message, now)
    return new ConnectionError(message, 'reauth_required')
  }

  if (fresh(connection)) {
    try {
      return decrypt(connection.accessToken!)
    } catch (err) {
      if (err instanceof TokenDecryptionError) throw await expire(say.unreadable)
      throw err
    }
  }

  const refresh = providerFor(connection.platform).refreshAccessToken
  if (!refresh || !connection.refreshToken) throw await expire(say.expired)

  try {
    return await database.transaction(async tx => {
      const [locked] = await tx
        .select()
        .from(platformConnectionsTable)
        .where(eq(platformConnectionsTable.id, connection.id))
        .for('update')
      const current = locked ?? null
      assertCanPublish(current, connection.platform)
      // Moved onto a Buffer connection while this waited: its token is not here.
      if (!current.accessToken) throw new RefreshRefused(say.expired)
      failing = { id: current.id, accessToken: current.accessToken }
      // Refreshed (or reconnected) while this waited for the lock.
      if (fresh(current)) return decrypt(current.accessToken)

      const refreshUsable =
        current.refreshToken &&
        (current.refreshTokenExpiresAt?.getTime() ?? Infinity) > now.getTime()
      if (!refreshUsable) throw new RefreshRefused(say.expired)

      const tokens = await refresh(
        config,
        decrypt(current.refreshToken!),
        fetchFn,
        now.getTime()
      )
      const encrypt = (value: string) =>
        encryptToken(value, config.encryptionKey, connection.userId)
      await tx
        .update(platformConnectionsTable)
        .set({
          accessToken: encrypt(tokens.accessToken),
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          // The platform may or may not rotate the refresh token (Buffer does).
          ...(tokens.refreshToken && {
            refreshToken: encrypt(tokens.refreshToken),
            refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
          }),
          updatedAt: now
        })
        .where(eq(platformConnectionsTable.id, current.id))
      return tokens.accessToken
    })
  } catch (err) {
    if (err instanceof ConnectionError) throw err
    if (err instanceof RefreshRefused) throw await expire(err.message)
    console.error(
      `Could not refresh the ${say.name} token of connection ${connection.id}:`,
      err
    )
    if (err instanceof TokenDecryptionError) throw await expire(say.unreadable)
    // The platform said no: the refresh token was revoked or ran out.
    if (
      err instanceof PlatformOAuthError &&
      (err.status === 400 || err.status === 401)
    ) {
      throw await expire(say.expired)
    }
    // An outage (network, the platform's 5xx, our database): nothing was sent.
    throw new PlatformApiError(
      `The ${say.name} connection could not be renewed just now. It will be tried again.`,
      'platform_unavailable'
    )
  }
}

/** Inside the refresh: there is no refresh token left to use. */
class RefreshRefused extends Error {}

/**
 * Switches the connection to another account on the same platform the user
 * already authorized (another X channel in their Buffer account), keeping
 * its credential. As with connecting a different account: auto-publishing
 * turns off and the platform's scheduled posts are cancelled.
 */
export async function changeAccount(
  database: PublishingDb,
  accountId: string,
  platform: PlatformId,
  member: AccountInfo,
  now = new Date()
): Promise<PlatformConnection | null> {
  return database.transaction(async tx => {
    const [previous] = await tx
      .select({ memberId: platformConnectionsTable.memberId })
      .from(platformConnectionsTable)
      .where(
        and(
          eq(platformConnectionsTable.accountId, accountId),
          eq(platformConnectionsTable.platform, platform),
          eq(platformConnectionsTable.status, 'connected')
        )
      )
      .for('update')
    if (!previous) return null
    const switched = previous.memberId !== member.memberId
    const [row] = await tx
      .update(platformConnectionsTable)
      .set({
        memberId: member.memberId,
        name: member.name,
        pictureUrl: member.pictureUrl,
        ...(switched && { autoPublish: false, autoPublishEnabledAt: null }),
        updatedAt: now
      })
      .where(
        and(
          eq(platformConnectionsTable.accountId, accountId),
          eq(platformConnectionsTable.platform, platform)
        )
      )
      .returning()
    if (switched) {
      await cancelPendingPublications(
        tx,
        { accountId, platform },
        {
          message: `Cancelled because a different ${messagesFor(platform).name} account was chosen.`,
          code: 'not_connected'
        },
        { includeUnsentInFlight: true, now }
      )
    }
    return row ?? null
  })
}

/** What the browser may see of a connection: never a token. */
export type ConnectionSummary = {
  platform: PlatformId
  status: PlatformConnection['status']
  name: string | null
  pictureUrl: string | null
  connectedAt: string
  expiresAt: string | null
  /** The platform renews the access token by itself (a refresh token). */
  renews: boolean
  /**
   * Publishes through the user's Buffer connection (memberId is the channel);
   * false for LinkedIn and for older Buffer connections with their own token.
   */
  viaBufferConnection: boolean
  /** The account's id on the platform: for Buffer, the channel's. */
  memberId: string
  canPublish: boolean
  lastError: string | null
  autoPublish: boolean
  autoPublishTime: string
  autoPublishTimezone: string | null
}

export function toConnectionSummary(
  connection: PlatformConnection
): ConnectionSummary {
  return {
    platform: connection.platform,
    status: connection.status,
    name: connection.name,
    pictureUrl: connection.pictureUrl,
    connectedAt: connection.connectedAt.toISOString(),
    expiresAt: connection.accessTokenExpiresAt?.toISOString() ?? null,
    renews: Boolean(connection.refreshToken),
    viaBufferConnection: Boolean(connection.bufferConnectionId),
    memberId: connection.memberId,
    canPublish: canPublish(connection),
    lastError: connection.lastError,
    autoPublish: connection.autoPublish,
    autoPublishTime: connection.autoPublishTime,
    autoPublishTimezone: connection.autoPublishTimezone
  }
}
