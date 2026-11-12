import { platformConnectionsTable, type PlatformConnection } from '@/db/schema'
import { DEFAULT_PLATFORM_ID, getPlatform, type PlatformId } from '@/lib/platforms'
import { and, eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import {
  type AccountInfo,
  type BaseConfig,
  type Credentials,
  type FetchFn,
  PlatformApiError,
  type PlatformConfig,
  PlatformOAuthError,
  providerFor
} from './provider'
import { cancelPendingPublications } from './publication-queries'
import {
  decryptToken,
  encryptToken,
  TokenDecryptionError
} from './token-crypto'

/**
 * A user's publishing connection to a platform: saving it after the OAuth
 * callback (or a pasted API key), removing it, and handing out a credential
 * that still works. One per user and platform. Always looked up by the
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

export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly code: 'not_connected' | 'reauth_required' | 'missing_permission'
  ) {
    super(message)
    this.name = 'ConnectionError'
  }
}

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
 */
export function assertCanPublish(
  connection: PlatformConnection | null,
  platform: PlatformId = connection?.platform ?? DEFAULT_PLATFORM_ID
): asserts connection is PlatformConnection & { accessToken: string } {
  const say = messagesFor(platform)
  if (
    !connection ||
    connection.status === 'disconnected' ||
    !connection.accessToken
  ) {
    throw new ConnectionError(say.notConnected, 'not_connected')
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

/** Who a connection is made by and for: the signed-in user, and their identity. */
export type ConnectionOwner = { userId: string; accountId: string }

/**
 * Saves the connection the callback (or a pasted key) just made, for the
 * identity it was started from, by its owner (the signed-in user, whose id
 * the tokens are encrypted for). Reconnecting replaces the credential in
 * place. Auto-publishing and scheduled posts survive a
 * reconnect of the same account, but not a switch to a different one:
 * auto-publishing must be turned on again knowingly, and scheduled posts
 * for that platform are cancelled.
 */
export async function saveConnection(
  database: PublishingDb,
  config: Pick<BaseConfig, 'encryptionKey'>,
  owner: ConnectionOwner,
  tokens: Credentials,
  member: AccountInfo,
  options: { now?: Date; platform?: PlatformId } = {}
): Promise<PlatformConnection> {
  const now = options.now ?? new Date()
  const platform = options.platform ?? DEFAULT_PLATFORM_ID
  const { userId, accountId } = owner
  const encrypt = (value: string | null) =>
    value === null ? null : encryptToken(value, config.encryptionKey, userId)
  const previous = await getConnection(database, accountId, platform)
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
      .values({ userId, accountId, platform, ...columns })
      .onConflictDoUpdate({
        target: [platformConnectionsTable.accountId, platformConnectionsTable.platform],
        set: columns
      })
      .returning()
    // Posts scheduled while connected as another account must not go out
    // under this one: they are cancelled, as on disconnecting.
    if (previous && !sameMember) {
      await cancelPendingPublications(
        tx,
        { accountId, platform },
        {
          message: `Cancelled because a different ${messagesFor(platform).name} account was connected.`,
          code: 'not_connected'
        },
        { includeUnsentInFlight: true, now }
      )
    }
    return row!
  })
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
 * Marks the connection expired, only while it still holds the credential that
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
 */
export async function usableAccessToken(
  database: PublishingDb,
  config: PlatformConfig,
  connection: PlatformConnection,
  fetchFn: FetchFn = fetch,
  now = new Date()
): Promise<string> {
  assertCanPublish(connection)
  const say = messagesFor(connection.platform)
  const decrypt = (value: string) =>
    decryptToken(value, config.encryptionKey, connection.userId)
  const fresh = (row: PlatformConnection) =>
    (row.accessTokenExpiresAt?.getTime() ?? Infinity) - EXPIRY_MARGIN_MS >
    now.getTime()
  // Marks expired whichever credential was in use when it failed.
  let failing = { id: connection.id, accessToken: connection.accessToken }
  const expire = async (message: string) => {
    await markExpired(database, failing, message, now)
    return new ConnectionError(message, 'reauth_required')
  }

  if (fresh(connection)) {
    try {
      return decrypt(connection.accessToken)
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
    canPublish: canPublish(connection),
    lastError: connection.lastError,
    autoPublish: connection.autoPublish,
    autoPublishTime: connection.autoPublishTime,
    autoPublishTimezone: connection.autoPublishTimezone
  }
}
