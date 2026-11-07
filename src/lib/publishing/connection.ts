import { platformConnectionsTable, type PlatformConnection } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import {
  type AccountInfo,
  type FetchFn,
  PlatformApiError,
  PlatformOAuthError,
  PUBLISH_SCOPE,
  type PublishingAppConfig,
  refreshAccessToken,
  type TokenSet
} from './provider'
import { cancelPendingPublications } from './publication-queries'
import {
  decryptToken,
  encryptToken,
  TokenDecryptionError
} from './token-crypto'
import { PUBLISHING_PLATFORM } from './platform'

/**
 * A user's publishing connection to the platform: saving it after the OAuth
 * callback, removing it, and handing out a token that still works. Always
 * looked up by the signed-in user's id, never by an id from a request, so one
 * user can never reach another's connection.
 *
 * Takes the database as an argument so tests can run it on any connection.
 */

export type PublishingDb = PgDatabase<PostgresJsQueryResultHKT, any, any>

/** A token closer than this to expiring is treated as expired. */
const EXPIRY_MARGIN_MS = 60_000

export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly code: 'not_connected' | 'reauth_required' | 'missing_permission'
  ) {
    super(message)
    this.name = 'ConnectionError'
  }
}

const PLATFORM = PUBLISHING_PLATFORM.name
const NOT_CONNECTED = `Connect ${PLATFORM} in Settings to publish.`
const EXPIRED = `Your ${PLATFORM} connection has expired. Reconnect ${PLATFORM} in Settings.`
const NO_PERMISSION = `${PLATFORM} did not grant permission to publish. Reconnect ${PLATFORM} and allow posting.`
const UNREADABLE = `The saved ${PLATFORM} connection can no longer be read. Reconnect ${PLATFORM} in Settings.`

/** Throws a ConnectionError unless the connection is there, working and allowed to post. */
export function assertCanPublish(
  connection: PlatformConnection | null
): asserts connection is PlatformConnection & { accessToken: string } {
  if (
    !connection ||
    connection.status === 'disconnected' ||
    !connection.accessToken
  ) {
    throw new ConnectionError(NOT_CONNECTED, 'not_connected')
  }
  if (connection.status === 'expired') {
    throw new ConnectionError(EXPIRED, 'reauth_required')
  }
  if (!canPublish(connection)) {
    throw new ConnectionError(NO_PERMISSION, 'missing_permission')
  }
}

export async function getConnection(
  database: PublishingDb,
  userId: string
): Promise<PlatformConnection | null> {
  const [row] = await database
    .select()
    .from(platformConnectionsTable)
    .where(eq(platformConnectionsTable.userId, userId))
    .limit(1)
  return row ?? null
}

/**
 * Saves the connection the callback just made, for `userId` (the signed-in
 * user who started it). Reconnecting replaces the tokens in place.
 * Auto-publishing and scheduled posts survive a reconnect of the same
 * member, but not a switch to a different platform account: auto-publishing
 * must be turned on again knowingly, and scheduled posts are cancelled.
 */
export async function saveConnection(
  database: PublishingDb,
  config: Pick<PublishingAppConfig, 'encryptionKey'>,
  userId: string,
  tokens: TokenSet,
  member: AccountInfo,
  now = new Date()
): Promise<PlatformConnection> {
  const encrypt = (value: string | null) =>
    value === null ? null : encryptToken(value, config.encryptionKey, userId)
  const previous = await getConnection(database, userId)
  const sameMember = previous?.memberId === member.memberId
  const columns = {
    memberId: member.memberId,
    name: member.name,
    pictureUrl: member.pictureUrl,
    accessToken: encrypt(tokens.accessToken),
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshToken: encrypt(tokens.refreshToken),
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    scopes: tokens.scopes,
    status: 'connected' as const,
    connectedAt: now,
    lastError: null,
    ...(!sameMember && { autoPublish: false, autoPublishEnabledAt: null }),
    updatedAt: now
  }
  return database.transaction(async tx => {
    const [row] = await tx
      .insert(platformConnectionsTable)
      .values({ userId, ...columns })
      .onConflictDoUpdate({
        target: platformConnectionsTable.userId,
        set: columns
      })
      .returning()
    // Posts scheduled while connected as another member must not go out
    // under this one: they are cancelled, as on disconnecting.
    if (previous && !sameMember) {
      await cancelPendingPublications(
        tx,
        { userId },
        {
          message: `Cancelled because a different ${PLATFORM} account was connected.`,
          code: 'not_connected'
        },
        { includeUnsentInFlight: true, now }
      )
    }
    return row!
  })
}

/**
 * Removes the connection: its tokens are deleted, auto-publishing turns off
 * and posts waiting to be published are cancelled (in flight too, until the
 * post is sent), so connecting again later never publishes something the
 * user had forgotten about. The row stays (as 'disconnected') so earlier
 * publications keep their history.
 */
export async function disconnect(
  database: PublishingDb,
  userId: string,
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
      .where(eq(platformConnectionsTable.userId, userId))
      .returning({ id: platformConnectionsTable.id })
    if (!row) return null
    const cancelled = await cancelPendingPublications(
      tx,
      { userId },
      {
        message: `Cancelled because ${PLATFORM} was disconnected.`,
        code: 'not_connected'
      },
      { includeUnsentInFlight: true, now }
    )
    return { cancelled }
  })
}

/**
 * Marks the connection expired, only while it still holds the token that
 * failed (`accessToken` as stored, encrypted): a reconnect or refresh in the
 * meantime is left alone.
 */
export async function markExpired(
  database: PublishingDb,
  connection: { id: string; accessToken: string },
  message: string,
  now = new Date()
) {
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

/** Whether the connection's grant includes posting. */
const canPublish = (connection: Pick<PlatformConnection, 'scopes'>) =>
  connection.scopes.includes(PUBLISH_SCOPE)

/**
 * A decrypted access token that still works, refreshed first when it has
 * run out and the platform gave this app a refresh token. The one place a
 * connection is marked expired (besides a 401 while publishing): when its
 * tokens cannot be read, have run out, or the platform refused the refresh.
 * Then the user must connect again: most platforms give apps no programmatic
 * refresh. A refresh that failed for any other reason (an outage) throws a
 * retryable PlatformApiError instead.
 */
export async function usableAccessToken(
  database: PublishingDb,
  config: PublishingAppConfig,
  connection: PlatformConnection,
  fetchFn: FetchFn = fetch,
  now = new Date()
): Promise<string> {
  assertCanPublish(connection)
  const { accessToken } = connection
  const expire = async (message: string) => {
    await markExpired(database, connection, message, now)
    return new ConnectionError(message, 'reauth_required')
  }
  const decrypt = (value: string) =>
    decryptToken(value, config.encryptionKey, connection.userId)

  const expiresAt = connection.accessTokenExpiresAt?.getTime() ?? Infinity
  if (expiresAt - EXPIRY_MARGIN_MS > now.getTime()) {
    try {
      return decrypt(accessToken)
    } catch (err) {
      if (err instanceof TokenDecryptionError) throw await expire(UNREADABLE)
      throw err
    }
  }

  const refreshUsable =
    connection.refreshToken &&
    (connection.refreshTokenExpiresAt?.getTime() ?? Infinity) > now.getTime()
  if (!refreshUsable) throw await expire(EXPIRED)
  try {
    const tokens = await refreshAccessToken(
      config,
      decrypt(connection.refreshToken!),
      fetchFn,
      now.getTime()
    )
    const encrypt = (value: string) =>
      encryptToken(value, config.encryptionKey, connection.userId)
    await database
      .update(platformConnectionsTable)
      .set({
        accessToken: encrypt(tokens.accessToken),
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        // The platform may or may not rotate the refresh token.
        ...(tokens.refreshToken && {
          refreshToken: encrypt(tokens.refreshToken),
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
        }),
        updatedAt: now
      })
      // Only over the token it replaces: a reconnect meanwhile wins.
      .where(
        and(
          eq(platformConnectionsTable.id, connection.id),
          eq(platformConnectionsTable.accessToken, accessToken)
        )
      )
    return tokens.accessToken
  } catch (err) {
    console.error(
      `Could not refresh the ${PLATFORM} token of connection ${connection.id}:`,
      err
    )
    if (err instanceof TokenDecryptionError) throw await expire(UNREADABLE)
    // The platform said no: the refresh token was revoked or ran out.
    if (
      err instanceof PlatformOAuthError &&
      (err.status === 400 || err.status === 401)
    ) {
      throw await expire(EXPIRED)
    }
    // An outage (network, the platform's 5xx, our database): nothing was sent.
    throw new PlatformApiError(
      `The ${PLATFORM} connection could not be renewed just now. It will be tried again.`,
      'platform_unavailable'
    )
  }
}

/** What the browser may see of a connection: never a token. */
export type ConnectionSummary = {
  status: PlatformConnection['status']
  name: string | null
  pictureUrl: string | null
  connectedAt: string
  expiresAt: string | null
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
    status: connection.status,
    name: connection.name,
    pictureUrl: connection.pictureUrl,
    connectedAt: connection.connectedAt.toISOString(),
    expiresAt: connection.accessTokenExpiresAt?.toISOString() ?? null,
    canPublish: canPublish(connection),
    lastError: connection.lastError,
    autoPublish: connection.autoPublish,
    autoPublishTime: connection.autoPublishTime,
    autoPublishTimezone: connection.autoPublishTimezone
  }
}
