import {
  bufferChannelsTable,
  bufferConnectionsTable,
  platformConnectionsTable,
  type BufferChannelRow,
  type BufferConnection,
  type PlatformConnection
} from '@/db/schema'
import { getPlatform } from '@/lib/platforms'
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  sql
} from 'drizzle-orm'
import { changeAccount, disconnect, type PublishingDb } from '../connection'
import { ConnectionError, PlatformApiError } from '../errors'
import {
  BUFFER_PLATFORM_IDS,
  bufferPlatformOf,
  type BufferPlatformId
} from '../platform'
import type { BufferConfig, FetchFn, TokenSet } from '../provider'
import { cancelPendingPublications } from '../publication-queries'
import {
  getAccount,
  listAllChannels,
  type BufferAccount,
  type BufferChannelDetail
} from './api'
import {
  getBufferConnection,
  markBufferExpired,
  tokenColumns,
  usableBufferToken
} from './token'

/**
 * A user's Buffer connection (one per user, buffer_connections) and the
 * channels in their Buffer account (buffer_channels):
 *
 *   connectBuffer        after the OAuth callback: save the grant, sync the
 *                        channels, and set up the networks (below)
 *   syncBufferChannels   read the account and channels from Buffer again
 *   linkBufferChannel    pick the channel a network publishes to, for an identity
 *   disconnectBuffer     forget the grant; stop every network publishing through it
 *
 * Each network's publishing connection (linkedin_connections, one per
 * identity and network) points at the Buffer connection and names a channel;
 * it borrows the Buffer connection's token (./token.ts). Everything is looked
 * up by the signed-in user's id, never an id from a request alone, so one
 * user can never reach another's Buffer account or channels.
 *
 * Takes the database as an argument so tests can run it on any connection.
 */

/** What one read of Buffer gives: the account and every channel in it. */
export type FetchedBufferAccount = {
  account: BufferAccount
  channels: BufferChannelDetail[]
}

/** Reads the account and every channel from Buffer with `accessToken`. Writes nothing. */
export async function fetchBufferAccount(
  config: Pick<BufferConfig, 'apiUrl'>,
  accessToken: string,
  fetchFn?: FetchFn
): Promise<FetchedBufferAccount> {
  const ctx = {
    apiKey: accessToken,
    apiUrl: config.apiUrl,
    fetchFn,
    platformName: 'Buffer'
  }
  const account = await getAccount(ctx)
  const channels = await listAllChannels(ctx, account.organizationIds)
  return { account, channels }
}

/** A channel a network's posts can go to now. */
const isUsable = (
  c: Pick<BufferChannelDetail, 'isLocked' | 'isDisconnected'>
) => !c.isLocked && !c.isDisconnected

/** The columns a network connection publishing through Buffer has. */
const linkedColumns = (
  connection: Pick<BufferConnection, 'id' | 'scopes'>,
  channel: { channelId: string; name: string; avatarUrl: string | null },
  now: Date
) => ({
  bufferConnectionId: connection.id,
  memberId: channel.channelId,
  name: channel.name,
  pictureUrl: channel.avatarUrl,
  // The credential is the Buffer connection's.
  accessToken: null,
  accessTokenExpiresAt: null,
  refreshToken: null,
  refreshTokenExpiresAt: null,
  scopes: connection.scopes,
  status: 'connected' as const,
  lastError: null,
  updatedAt: now
})

const channelName = (c: Pick<BufferChannelRow, 'displayName' | 'name'>) =>
  c.displayName || c.name

/**
 * Writes the channels Buffer just listed: new ones added, known ones updated,
 * ones it no longer lists kept with removed_at set. The network connections
 * publishing to them get their current name and picture.
 */
async function writeChannels(
  tx: PublishingDb,
  connection: Pick<BufferConnection, 'id' | 'userId'>,
  channels: BufferChannelDetail[],
  now: Date
) {
  if (channels.length > 0) {
    const excluded = (column: string) => sql.raw(`excluded."${column}"`)
    await tx
      .insert(bufferChannelsTable)
      .values(
        channels.map(c => ({
          connectionId: connection.id,
          userId: connection.userId,
          channelId: c.id,
          organizationId: c.organizationId,
          service: c.service.slice(0, 40),
          channelType: c.type?.slice(0, 40) ?? null,
          name: c.handle || c.name,
          displayName: c.name !== c.handle ? c.name : null,
          avatarUrl: c.avatar,
          externalLink: c.externalLink,
          isDisconnected: c.isDisconnected,
          isLocked: c.isLocked,
          removedAt: null,
          lastSyncedAt: now,
          updatedAt: now
        }))
      )
      .onConflictDoUpdate({
        target: [
          bufferChannelsTable.connectionId,
          bufferChannelsTable.channelId
        ],
        set: {
          organizationId: excluded('organization_id'),
          service: excluded('service'),
          channelType: excluded('channel_type'),
          name: excluded('name'),
          displayName: excluded('display_name'),
          avatarUrl: excluded('avatar_url'),
          externalLink: excluded('external_link'),
          isDisconnected: excluded('is_disconnected'),
          isLocked: excluded('is_locked'),
          removedAt: null,
          lastSyncedAt: now,
          updatedAt: now
        }
      })
  }
  await tx
    .update(bufferChannelsTable)
    .set({ removedAt: now, updatedAt: now })
    .where(
      and(
        eq(bufferChannelsTable.connectionId, connection.id),
        isNull(bufferChannelsTable.removedAt),
        channels.length > 0
          ? notInArray(
              bufferChannelsTable.channelId,
              channels.map(c => c.id)
            )
          : undefined
      )
    )
  // Names and pictures change in Buffer; the network connections follow.
  await tx.execute(sql`
    update ${platformConnectionsTable} as lc
    set name = coalesce(bc.display_name, bc.name), picture_url = bc.avatar_url, updated_at = ${now.toISOString()}::timestamptz
    from ${bufferChannelsTable} as bc
    where lc.buffer_connection_id = ${connection.id}
      and bc.connection_id = ${connection.id}
      and bc.channel_id = lc.member_id
      and bc.removed_at is null
      and (lc.name is distinct from coalesce(bc.display_name, bc.name)
        or lc.picture_url is distinct from bc.avatar_url)
  `)
}

/**
 * Brings the network connections in line with a fresh grant and channel list:
 *
 *  1. Those already publishing through this Buffer connection are working
 *     again (an expired one is revived) while their channel is in the
 *     account. With `dropMissing` (a different Buffer account was connected),
 *     one whose channel is not is disconnected, its scheduled posts
 *     cancelled.
 *  2. Older ones holding their own Buffer token or API key move onto this
 *     connection when their channel is in the account: same channel, so
 *     auto-publishing and scheduled posts carry on.
 *  3. For `identityId` (the identity the user connected from), each network
 *     in `platforms` without a working connection gets the first usable
 *     channel of that network; Settings can change it.
 *
 * Returns the networks set up in step 3.
 */
async function reconcileNetworkConnections(
  tx: PublishingDb,
  connection: BufferConnection,
  channels: BufferChannelDetail[],
  options: {
    identityId: string | null
    platforms: readonly BufferPlatformId[]
    dropMissing: boolean
    now: Date
  }
): Promise<BufferPlatformId[]> {
  const { now } = options
  const byId = new Map(channels.map(c => [c.id, c]))
  const channelFor = (
    row: Pick<PlatformConnection, 'memberId' | 'platform'>
  ) => {
    const channel = byId.get(row.memberId)
    return channel && bufferPlatformOf(channel.service) === row.platform
      ? channel
      : null
  }
  const columnsFor = (channel: BufferChannelDetail) =>
    linkedColumns(
      connection,
      { channelId: channel.id, name: channel.name, avatarUrl: channel.avatar },
      now
    )

  // 1 and 2: this user's network connections through Buffer, working or expired.
  const rows = await tx
    .select()
    .from(platformConnectionsTable)
    .where(
      and(
        eq(platformConnectionsTable.userId, connection.userId),
        inArray(platformConnectionsTable.platform, [...BUFFER_PLATFORM_IDS]),
        ne(platformConnectionsTable.status, 'disconnected'),
        or(
          eq(platformConnectionsTable.bufferConnectionId, connection.id),
          isNull(platformConnectionsTable.bufferConnectionId)
        )
      )
    )
    .for('update')
  for (const row of rows) {
    const channel = channelFor(row)
    const linked = row.bufferConnectionId === connection.id
    if (channel) {
      await tx
        .update(platformConnectionsTable)
        .set(columnsFor(channel))
        .where(eq(platformConnectionsTable.id, row.id))
    } else if (linked && options.dropMissing && row.accountId) {
      await disconnect(tx, row.accountId, row.platform, now)
    }
    // An older connection whose channel is not here keeps its own credential.
  }

  // 3: the networks the identity has nothing working for.
  const linkedNow: BufferPlatformId[] = []
  if (!options.identityId) return linkedNow
  for (const platform of options.platforms) {
    const [existing] = await tx
      .select({ status: platformConnectionsTable.status })
      .from(platformConnectionsTable)
      .where(
        and(
          eq(platformConnectionsTable.accountId, options.identityId),
          eq(platformConnectionsTable.platform, platform)
        )
      )
      .limit(1)
    if (existing && existing.status !== 'disconnected') continue
    const channel = channels.find(
      c => bufferPlatformOf(c.service) === platform && isUsable(c)
    )
    if (!channel) continue
    const columns = {
      ...columnsFor(channel),
      connectedAt: now,
      // A disconnected one already had it turned off; a new one starts off.
      autoPublish: false,
      autoPublishEnabledAt: null
    }
    await tx
      .insert(platformConnectionsTable)
      .values({
        userId: connection.userId,
        accountId: options.identityId,
        platform,
        ...columns
      })
      .onConflictDoUpdate({
        target: [
          platformConnectionsTable.accountId,
          platformConnectionsTable.platform
        ],
        set: columns
      })
    linkedNow.push(platform)
  }
  return linkedNow
}

/** Who connects Buffer: the signed-in user, and the identity they connect from. */
export type BufferOwner = { userId: string; identityId: string | null }

/**
 * Saves the grant the OAuth callback just received, with the account and
 * channels read with it (fetchBufferAccount), and sets up the networks
 * (reconcileNetworkConnections). Connecting again (the same Buffer account
 * or another) replaces the tokens in place: one Buffer connection per user.
 */
export async function connectBuffer(
  database: PublishingDb,
  config: Pick<BufferConfig, 'encryptionKey' | 'tokenEncryptionKey'>,
  owner: BufferOwner,
  tokens: TokenSet,
  fetched: FetchedBufferAccount,
  options: { platforms: readonly BufferPlatformId[]; now?: Date }
): Promise<{ connection: BufferConnection; linked: BufferPlatformId[] }> {
  const now = options.now ?? new Date()
  const { account, channels } = fetched
  return database.transaction(async tx => {
    const [previous] = await tx
      .select({ bufferAccountId: bufferConnectionsTable.bufferAccountId })
      .from(bufferConnectionsTable)
      .where(eq(bufferConnectionsTable.userId, owner.userId))
      .for('update')
    const columns = {
      bufferAccountId: account.id,
      name: account.name,
      email: account.email,
      avatarUrl: account.avatar,
      ...tokenColumns(config, owner.userId, tokens),
      scopes: tokens.scopes,
      status: 'connected' as const,
      lastError: null,
      connectedAt: now,
      lastSyncedAt: now,
      updatedAt: now
    }
    const [connection] = await tx
      .insert(bufferConnectionsTable)
      .values({ userId: owner.userId, ...columns })
      .onConflictDoUpdate({
        target: bufferConnectionsTable.userId,
        set: columns
      })
      .returning()
    // Another Buffer account's channels are not this one's.
    const switched = Boolean(
      previous && previous.bufferAccountId !== account.id
    )
    if (switched) {
      await tx
        .delete(bufferChannelsTable)
        .where(eq(bufferChannelsTable.connectionId, connection!.id))
    }
    await writeChannels(tx, connection!, channels, now)
    const linked = await reconcileNetworkConnections(
      tx,
      connection!,
      channels,
      {
        identityId: owner.identityId,
        platforms: options.platforms,
        dropMissing: switched,
        now
      }
    )
    return { connection: connection!, linked }
  })
}

/** Syncing again sooner than this answers with what was read last time. */
export const MIN_SYNC_INTERVAL_MS = 30_000

/**
 * Reads the user's Buffer account and channels again (Sync now in Settings),
 * and sets up networks for `identityId` that have no connection yet. A token
 * Buffer refuses marks the connection expired. Within MIN_SYNC_INTERVAL_MS of
 * the last sync it does nothing and says so, to spare the rate limit.
 */
export async function syncBufferChannels(
  database: PublishingDb,
  config: BufferConfig,
  owner: BufferOwner,
  options: {
    platforms: readonly BufferPlatformId[]
    fetchFn?: FetchFn
    now?: Date
    force?: boolean
  }
): Promise<{ synced: boolean; linked: BufferPlatformId[] }> {
  const now = options.now ?? new Date()
  const connection = await getBufferConnection(database, owner.userId)
  if (!connection || connection.status === 'disconnected') {
    throw new ConnectionError('Connect Buffer first.', 'not_connected')
  }
  if (
    !options.force &&
    connection.status === 'connected' &&
    connection.lastSyncedAt &&
    now.getTime() - connection.lastSyncedAt.getTime() < MIN_SYNC_INTERVAL_MS
  ) {
    return { synced: false, linked: [] }
  }
  const { accessToken, stored } = await usableBufferToken(
    database,
    config,
    { connectionId: connection.id, userId: owner.userId },
    options.fetchFn,
    now
  )
  let fetched: FetchedBufferAccount
  try {
    fetched = await fetchBufferAccount(config, accessToken, options.fetchFn)
  } catch (err) {
    if (err instanceof PlatformApiError && err.code === 'reauth_required') {
      const message =
        'Buffer no longer accepts this connection (it may have been removed in Buffer). Reconnect Buffer.'
      await markBufferExpired(database, connection.id, stored, message, now)
      throw new ConnectionError(message, 'reauth_required')
    }
    throw err
  }
  const linked = await database.transaction(async tx => {
    const [current] = await tx
      .update(bufferConnectionsTable)
      .set({
        name: fetched.account.name,
        email: fetched.account.email,
        avatarUrl: fetched.account.avatar,
        lastSyncedAt: now,
        updatedAt: now
      })
      .where(
        and(
          eq(bufferConnectionsTable.id, connection.id),
          eq(bufferConnectionsTable.status, 'connected')
        )
      )
      .returning()
    // Disconnected while Buffer was being read: nothing to write.
    if (!current) return []
    await writeChannels(tx, current, fetched.channels, now)
    return reconcileNetworkConnections(tx, current, fetched.channels, {
      identityId: owner.identityId,
      platforms: options.platforms,
      dropMissing: false,
      now
    })
  })
  return { synced: true, linked }
}

/**
 * Publishes `platform` for the identity as one of the channels in the user's
 * Buffer account (as last synced). Switching to another channel turns
 * auto-publishing off and cancels that network's scheduled posts, as
 * connecting a different account always has.
 */
export async function linkBufferChannel(
  database: PublishingDb,
  owner: { userId: string; identityId: string },
  platform: BufferPlatformId,
  channelId: string,
  now = new Date()
): Promise<PlatformConnection> {
  const name = getPlatform(platform).name
  const connection = await getBufferConnection(database, owner.userId)
  if (!connection || connection.status === 'disconnected') {
    throw new ConnectionError('Connect Buffer first.', 'not_connected')
  }
  if (connection.status === 'expired') {
    throw new ConnectionError(
      'Your Buffer connection has expired. Reconnect Buffer first.',
      'reauth_required'
    )
  }
  const [channel] = await database
    .select()
    .from(bufferChannelsTable)
    .where(
      and(
        eq(bufferChannelsTable.connectionId, connection.id),
        eq(bufferChannelsTable.userId, owner.userId),
        eq(bufferChannelsTable.channelId, channelId),
        isNull(bufferChannelsTable.removedAt)
      )
    )
    .limit(1)
  if (!channel || bufferPlatformOf(channel.service) !== platform) {
    throw new ConnectionError(
      `That ${name} account is not in your Buffer account. Sync, then pick again.`,
      'not_connected'
    )
  }
  if (channel.isDisconnected) {
    throw new ConnectionError(
      `Buffer lost access to this ${name} account. Reconnect it in Buffer, then sync.`,
      'missing_permission'
    )
  }
  if (channel.isLocked) {
    throw new ConnectionError(
      `This ${name} account is locked in Buffer (over your plan's channel limit). Unlock it in Buffer, then sync.`,
      'missing_permission'
    )
  }
  const member = {
    memberId: channel.channelId,
    name: channelName(channel),
    pictureUrl: channel.avatarUrl
  }
  return database.transaction(async tx => {
    const [existing] = await tx
      .select()
      .from(platformConnectionsTable)
      .where(
        and(
          eq(platformConnectionsTable.accountId, owner.identityId),
          eq(platformConnectionsTable.platform, platform)
        )
      )
      .for('update')
    // Already publishing through Buffer: a switch of channel.
    if (
      existing?.status === 'connected' &&
      existing.bufferConnectionId === connection.id
    ) {
      return (await changeAccount(tx, owner.identityId, platform, member, now))!
    }
    const working = existing && existing.status !== 'disconnected'
    const switched = working && existing.memberId !== channel.channelId
    const columns = {
      ...linkedColumns(
        connection,
        {
          channelId: channel.channelId,
          name: member.name,
          avatarUrl: channel.avatarUrl
        },
        now
      ),
      // Moving an older connection onto Buffer keeps its date and schedule.
      ...(!working && { connectedAt: now }),
      ...((!working || switched) && {
        autoPublish: false,
        autoPublishEnabledAt: null
      })
    }
    const [row] = await tx
      .insert(platformConnectionsTable)
      .values({
        userId: owner.userId,
        accountId: owner.identityId,
        platform,
        ...columns
      })
      .onConflictDoUpdate({
        target: [
          platformConnectionsTable.accountId,
          platformConnectionsTable.platform
        ],
        set: columns
      })
      .returning()
    if (switched) {
      await cancelPendingPublications(
        tx,
        { accountId: owner.identityId, platform },
        {
          message: `Cancelled because a different ${name} account was chosen.`,
          code: 'not_connected'
        },
        { includeUnsentInFlight: true, now }
      )
    }
    return row!
  })
}

/**
 * Forgets the user's Buffer grant: its tokens are deleted, its channels
 * forgotten, and every network publishing through Buffer for any of the
 * user's identities is disconnected (scheduled posts cancelled, auto-publishing
 * off), older ones with their own Buffer token or key included. The row stays,
 * 'disconnected'. Buffer has no endpoint to revoke a grant: the user removes
 * the app in Buffer's settings for that. Null when there was nothing to
 * disconnect.
 */
export async function disconnectBuffer(
  database: PublishingDb,
  userId: string,
  now = new Date()
): Promise<{ cancelled: number } | null> {
  return database.transaction(async tx => {
    const [row] = await tx
      .update(bufferConnectionsTable)
      .set({
        status: 'disconnected',
        accessToken: null,
        accessTokenExpiresAt: null,
        refreshToken: null,
        lastError: null,
        updatedAt: now
      })
      .where(
        and(
          eq(bufferConnectionsTable.userId, userId),
          ne(bufferConnectionsTable.status, 'disconnected')
        )
      )
      .returning({ id: bufferConnectionsTable.id })
    if (!row) return null
    await tx
      .delete(bufferChannelsTable)
      .where(eq(bufferChannelsTable.connectionId, row.id))
    const networks = await tx
      .select({
        accountId: platformConnectionsTable.accountId,
        platform: platformConnectionsTable.platform
      })
      .from(platformConnectionsTable)
      .where(
        and(
          eq(platformConnectionsTable.userId, userId),
          inArray(platformConnectionsTable.platform, [...BUFFER_PLATFORM_IDS]),
          ne(platformConnectionsTable.status, 'disconnected')
        )
      )
    let cancelled = 0
    for (const network of networks) {
      if (!network.accountId) continue
      const result = await disconnect(
        tx,
        network.accountId,
        network.platform,
        now
      )
      cancelled += result?.cancelled ?? 0
    }
    return { cancelled }
  })
}

// ---------------------------------------------------------------------------
// What the browser may see: never a token
// ---------------------------------------------------------------------------

export type BufferChannelSummary = {
  channelId: string
  /** Buffer's service name ("twitter", "linkedin", …). */
  service: string
  /** The network it publishes to here; null when not one published through Buffer. */
  platform: BufferPlatformId | null
  name: string
  handle: string
  avatarUrl: string | null
  externalLink: string | null
  type: string | null
  isLocked: boolean
  isDisconnected: boolean
}

export type BufferSummary = {
  status: BufferConnection['status']
  name: string | null
  email: string | null
  avatarUrl: string | null
  connectedAt: string
  lastSyncedAt: string | null
  lastError: string | null
  /** The grant lets the app read channels and create posts. */
  canPublish: boolean
  /** Buffer renews the access token by itself (a refresh token). */
  renews: boolean
  channels: BufferChannelSummary[]
}

export function toBufferSummary(
  connection: BufferConnection,
  channels: BufferChannelRow[]
): BufferSummary {
  return {
    status: connection.status,
    name: connection.name,
    email: connection.email,
    avatarUrl: connection.avatarUrl,
    connectedAt: connection.connectedAt.toISOString(),
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    lastError: connection.lastError,
    canPublish:
      connection.scopes.includes('account:read') &&
      connection.scopes.includes('posts:write'),
    renews: Boolean(connection.refreshToken),
    channels: channels
      .filter(c => !c.removedAt)
      .map(c => ({
        channelId: c.channelId,
        service: c.service,
        platform: bufferPlatformOf(c.service),
        name: channelName(c),
        handle: c.name,
        avatarUrl: c.avatarUrl,
        externalLink: c.externalLink,
        type: c.channelType,
        isLocked: c.isLocked,
        isDisconnected: c.isDisconnected
      }))
  }
}

/** The user's Buffer connection and channels, as the browser may see them; null when never connected. */
export async function getBufferSummary(
  database: PublishingDb,
  userId: string
): Promise<BufferSummary | null> {
  const connection = await getBufferConnection(database, userId)
  if (!connection) return null
  const channels = await database
    .select()
    .from(bufferChannelsTable)
    .where(
      and(
        eq(bufferChannelsTable.connectionId, connection.id),
        eq(bufferChannelsTable.userId, userId),
        isNull(bufferChannelsTable.removedAt)
      )
    )
    .orderBy(asc(bufferChannelsTable.service), asc(bufferChannelsTable.name))
  return toBufferSummary(connection, channels)
}
