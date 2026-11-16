import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import {
  connectBuffer,
  disconnectBuffer,
  fetchBufferAccount,
  getBufferSummary,
  linkBufferChannel,
  syncBufferChannels
} from '../src/lib/publishing/buffer/connection'
import { usableBufferToken } from '../src/lib/publishing/buffer/token'
import { ConnectionError, getConnection } from '../src/lib/publishing/connection'
import {
  claimPublication,
  confirmPendingPublications,
  executePublication,
  PublishRequestError,
  requestPublication
} from '../src/lib/publishing/engine'
import type { BufferConfig, TokenSet } from '../src/lib/publishing/provider'
import { decryptToken } from '../src/lib/publishing/token-crypto'
import { insertLegacyConnection } from './fixtures/legacy-connection'

/**
 * The Buffer OAuth connection against a real database, with Buffer (its
 * token endpoint and GraphQL API) replaced by a stub that, like Buffer,
 * accepts each refresh token once and revokes the grant when a spent one
 * comes back. Runs only when DATABASE_URL is set in the environment (never
 * from .env, which may be a shared database); every row it makes is removed.
 */

const url = process.env.DATABASE_URL
const tag = `qa-bo-${Date.now().toString(36)}`
const BUFFER_URL = 'https://buffer.example/graphql'
const TOKEN_URL = 'https://auth.buffer.com/token'
const SCOPES = ['account:read', 'posts:read', 'posts:write', 'offline_access']

const tokenKey = randomBytes(32)
const config: BufferConfig = {
  oauth: {
    clientId: 'buffer-client',
    clientSecret: 'buffer-secret',
    redirectUri: 'https://app.example.com/api/integrations/buffer/callback',
    scopes: SCOPES
  },
  apiUrl: BUFFER_URL,
  appUrl: 'https://app.example.com',
  encryptionKey: randomBytes(32),
  tokenEncryptionKey: tokenKey,
  inlineWaitMs: 0
}
const PLATFORMS = ['linkedin', 'x', 'threads', 'facebook', 'instagram'] as const

type Channel = {
  id: string
  name: string
  displayName?: string
  service: string
  isLocked?: boolean
  isDisconnected?: boolean
}

const DEFAULT_CHANNELS: Channel[] = [
  { id: 'X1', name: 'qa_one', displayName: 'QA One', service: 'twitter' },
  { id: 'X2', name: 'qa_two', service: 'twitter' },
  { id: 'F1', name: 'QA Page', service: 'facebook' },
  { id: 'I1', name: 'locked.ig', service: 'instagram', isLocked: true },
  { id: 'I2', name: 'qa.ig', service: 'instagram' },
  { id: 'T1', name: 'qa.threads', service: 'threads', isDisconnected: true },
  { id: 'L1', name: 'QA LinkedIn', service: 'linkedin' },
  { id: 'K1', name: 'qa.tiktok', service: 'tiktok' }
]

/** Buffer: the token endpoint and the GraphQL API, for one or more accounts. */
function fakeBuffer() {
  const accounts = new Map<string, { id: string; channels: Channel[] }>()
  // Access token → the account it is for; absent means revoked or unknown.
  const accessTokens = new Map<string, string>()
  // Refresh token → its account, and whether it was used.
  const refreshTokens = new Map<string, { account: string; used: boolean }>()
  let issued = 0
  const stub = {
    refreshes: 0,
    refreshDelayMs: 0,
    /** What createPost answers with: sent at once, or still on its way. */
    createStatus: 'sent' as 'sent' | 'sending',
    calls: [] as Array<{ operation: string; auth: string; variables: any }>,
    setAccount(id: string, channels: Channel[]) {
      accounts.set(id, { id, channels })
    },
    /** A grant as the code exchange would give it: tokens Buffer accepts. */
    grant(account: string, expiresInMs = 3_600_000): TokenSet {
      issued++
      const accessToken = `AT-${account}-${issued}`
      const refreshToken = `RT-${account}-${issued}`
      accessTokens.set(accessToken, account)
      refreshTokens.set(refreshToken, { account, used: false })
      return {
        accessToken,
        accessTokenExpiresAt: new Date(Date.now() + expiresInMs),
        refreshToken,
        refreshTokenExpiresAt: null,
        scopes: SCOPES
      }
    },
    revokeAccess(token: string) {
      accessTokens.delete(token)
    },
    creates: () => stub.calls.filter(c => c.operation === 'CreatePost'),
    /** A new test: counters cleared; accounts and issued tokens kept. */
    reset() {
      stub.calls = []
      stub.refreshes = 0
      stub.refreshDelayMs = 0
      stub.createStatus = 'sent'
    },
    fetchFn: (async (input: string | URL, init: RequestInit = {}) => {
      if (String(input) === TOKEN_URL) {
        const body = new URLSearchParams(String(init.body))
        assert.strictEqual(body.get('grant_type'), 'refresh_token')
        stub.refreshes++
        if (stub.refreshDelayMs)
          await new Promise(r => setTimeout(r, stub.refreshDelayMs))
        const sent = refreshTokens.get(body.get('refresh_token')!)
        if (!sent || sent.used) {
          // A spent refresh token revokes every token of the grant.
          if (sent)
            for (const [t, a] of accessTokens)
              if (a === sent.account) accessTokens.delete(t)
          return Response.json(
            {
              error: 'invalid_grant',
              error_description: 'Refresh token is invalid'
            },
            { status: 400 }
          )
        }
        sent.used = true
        const next = stub.grant(sent.account)
        return Response.json({
          access_token: next.accessToken,
          refresh_token: next.refreshToken,
          expires_in: 3600,
          token_type: 'Bearer',
          scope: SCOPES.join(' ')
        })
      }
      assert.strictEqual(String(input), BUFFER_URL)
      const body = JSON.parse(String(init.body))
      const operation = /(query|mutation)\s+(\w+)/.exec(body.query)![2]!
      const auth = (init.headers as Record<string, string>).Authorization!
      stub.calls.push({ operation, auth, variables: body.variables })
      const account = accounts.get(
        accessTokens.get(auth.replace('Bearer ', '')) ?? ''
      )
      if (!account) {
        return Response.json({
          errors: [
            { message: 'Unauthorized', extensions: { code: 'UNAUTHORIZED' } }
          ]
        })
      }
      if (operation === 'Account') {
        return Response.json({
          data: {
            account: {
              id: account.id,
              name: `Owner of ${account.id}`,
              email: `${account.id.toLowerCase()}@example.com`,
              avatar: 'https://cdn.example/owner.png',
              organizations: [{ id: `ORG-${account.id}` }]
            }
          }
        })
      }
      if (operation === 'Channels') {
        return Response.json({
          data: {
            channels: account.channels.map(c => ({
              ...c,
              type: 'profile',
              avatar: `https://cdn.example/${c.id}.png`,
              organizationId: `ORG-${account.id}`
            }))
          }
        })
      }
      const post = (id: string, status: string) => ({
        id,
        status,
        externalLink: status === 'sent' ? `https://x.com/qa/status/${id}` : null,
        sentAt: status === 'sent' ? new Date().toISOString() : null
      })
      if (operation === 'CreatePost') {
        const id = `P${stub.creates().length}`
        return Response.json({
          data: {
            createPost: {
              __typename: 'PostActionSuccess',
              post: post(id, stub.createStatus)
            }
          }
        })
      }
      // Following a post: by now Buffer has sent it.
      if (operation === 'Post') {
        return Response.json({
          data: { post: post(body.variables.input.id, 'sent') }
        })
      }
      return Response.json({
        errors: [{ message: 'unknown', extensions: { code: 'NOT_FOUND' } }]
      })
    }) as typeof fetch
  }
  return stub
}

describe('Buffer OAuth connection', { skip: !url }, () => {
  const client = postgres(url!, { max: 6, prepare: false })
  const database = drizzle(client, { schema })
  const buffer = fakeBuffer()
  const deps = () => ({
    database,
    configs: {
      x: config,
      threads: config,
      facebook: config,
      instagram: config
    },
    fetchFn: buffer.fetchFn,
    loadImage: async () => null
  })

  type Owner = { userId: string; accountId: string }

  const newUser = async (name: string): Promise<Owner> => {
    const [user] = await database
      .insert(schema.authUsersTable)
      .values({
        name,
        email: `${tag}-${name}@example.com`,
        emailVerified: true
      })
      .returning()
    const [account] = await database
      .insert(schema.accountsTable)
      .values({
        userId: user!.id,
        name,
        handle: `${tag}-${name}`,
        headline: 'QA'
      })
      .returning()
    return { userId: user!.id, accountId: account!.id }
  }

  /** Connects Buffer as the OAuth callback does: read with the new token, then save. */
  const connect = async (
    owner: Owner,
    account: string,
    tokens = buffer.grant(account)
  ) => {
    const fetched = await fetchBufferAccount(
      config,
      tokens.accessToken,
      buffer.fetchFn
    )
    return connectBuffer(
      database,
      config,
      { userId: owner.userId, identityId: owner.accountId },
      tokens,
      fetched,
      { platforms: PLATFORMS }
    )
  }

  const bufferRow = async (userId: string) =>
    (
      await database
        .select()
        .from(schema.bufferConnectionsTable)
        .where(eq(schema.bufferConnectionsTable.userId, userId))
    )[0]!

  const xPost = async (accountId: string) => {
    const [draft] = await database
      .insert(schema.postDraftsTable)
      .values({
        accountId,
        platform: 'x',
        formatId: 'x.post',
        hook: 'A short hook',
        body: 'The body',
        originalHook: 'A short hook',
        originalBody: 'The body',
        status: 'approved'
      })
      .returning()
    return draft!.id
  }

  const publishNow = async (owner: Owner) => {
    const row = await requestPublication(database, {
      userId: owner.userId,
      draftId: await xPost(owner.accountId),
      trigger: 'manual',
      scheduledAt: new Date()
    })
    const claimed = await claimPublication(database, row.id)
    assert.ok(claimed, 'claimed')
    return executePublication(deps(), claimed)
  }

  /** An X post scheduled for tomorrow: what a disconnect or switch must cancel. */
  const scheduleX = async (owner: Owner) =>
    requestPublication(database, {
      userId: owner.userId,
      draftId: await xPost(owner.accountId),
      trigger: 'manual',
      scheduledAt: new Date(Date.now() + 86_400_000)
    })

  const publicationStatus = async (id: string) =>
    (
      await database
        .select({ status: schema.publicationsTable.status })
        .from(schema.publicationsTable)
        .where(eq(schema.publicationsTable.id, id))
    )[0]!.status

  const expireAccessToken = (userId: string) =>
    database
      .update(schema.bufferConnectionsTable)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.bufferConnectionsTable.userId, userId))

  let a: Owner
  before(async () => {
    a = await newUser('a')
  })
  beforeEach(() => {
    buffer.reset()
    buffer.setAccount(
      'ACC-A',
      DEFAULT_CHANNELS.map(c => ({ ...c }))
    )
    buffer.setAccount('ACC-B', [
      { id: 'XB', name: 'b_on_x', service: 'twitter' }
    ])
  })
  after(async () => {
    await client`delete from auth_users where email like ${`${tag}-%`}`
    await client.end()
  })

  it('connecting saves the tokens encrypted, the account and every channel, and sets up each network', async () => {
    const tokens = buffer.grant('ACC-A')
    const { linked } = await connect(a, 'ACC-A', tokens)
    assert.deepStrictEqual(linked.sort(), [
      'facebook',
      'instagram',
      'linkedin',
      'x'
    ])

    const row = await bufferRow(a.userId)
    assert.strictEqual(row.status, 'connected')
    assert.strictEqual(row.bufferAccountId, 'ACC-A')
    assert.strictEqual(row.email, 'acc-a@example.com')
    assert.ok(row.lastSyncedAt)
    assert.deepStrictEqual(row.scopes, SCOPES)
    // Encrypted with the Buffer key, for this user: never the plain tokens.
    assert.ok(!row.accessToken!.includes(tokens.accessToken))
    assert.ok(!row.refreshToken!.includes(tokens.refreshToken!))
    assert.strictEqual(
      decryptToken(row.accessToken!, tokenKey, a.userId),
      tokens.accessToken
    )
    assert.strictEqual(
      decryptToken(row.refreshToken!, tokenKey, a.userId),
      tokens.refreshToken
    )

    // Every channel, on every network, is kept.
    const channels = await database
      .select()
      .from(schema.bufferChannelsTable)
      .where(eq(schema.bufferChannelsTable.userId, a.userId))
    assert.strictEqual(channels.length, DEFAULT_CHANNELS.length)

    // The first usable channel of each network; none for Threads (disconnected in Buffer).
    const x = (await getConnection(database, a.accountId, 'x'))!
    assert.strictEqual(x.memberId, 'X1')
    assert.strictEqual(x.name, 'QA One')
    assert.strictEqual(x.bufferConnectionId, row.id)
    assert.strictEqual(
      x.accessToken,
      null,
      'borrows the Buffer token, holds none'
    )
    assert.strictEqual(
      (await getConnection(database, a.accountId, 'instagram'))!.memberId,
      'I2'
    )
    assert.strictEqual(
      await getConnection(database, a.accountId, 'threads'),
      null
    )

    // What the browser sees has no token in it.
    const summary = (await getBufferSummary(database, a.userId))!
    const json = JSON.stringify(summary)
    assert.ok(!json.includes(tokens.accessToken) && !json.includes('v1:'))
    // LinkedIn publishes through Buffer like the others; TikTok is listed only.
    assert.strictEqual(
      (await getConnection(database, a.accountId, 'linkedin'))!.memberId,
      'L1'
    )
    assert.strictEqual(
      summary.channels.find(c => c.channelId === 'L1')!.platform,
      'linkedin'
    )
    assert.strictEqual(
      summary.channels.find(c => c.channelId === 'K1')!.platform,
      null
    )
    assert.strictEqual(summary.canPublish, true)
  })

  it("publishes with the Buffer connection's OAuth token, to the picked channel", async () => {
    const result = await publishNow(a)
    assert.strictEqual(result.status, 'published', String(result.error))
    const [create] = buffer.creates()
    assert.match(create!.auth, /^Bearer AT-ACC-A-\d+$/)
    assert.strictEqual(create!.variables.input.channelId, 'X1')
  })

  it('a post Buffer is still sending is confirmed later through the Buffer connection, not given up', async () => {
    buffer.createStatus = 'sending'
    const pending = await publishNow(a)
    assert.strictEqual(pending.status, 'publishing', String(pending.error))
    assert.ok(pending.externalPostId)
    // The network connection holds no token of its own: the Buffer
    // connection's is used to follow the post.
    assert.strictEqual(
      (await getConnection(database, a.accountId, 'x'))!.accessToken,
      null
    )

    // A minute on: past Publish now's own short wait, as the worker sees it.
    await confirmPendingPublications({
      ...deps(),
      now: () => new Date(Date.now() + 60_000)
    })
    const [row] = await database
      .select()
      .from(schema.publicationsTable)
      .where(eq(schema.publicationsTable.id, pending.id))
    assert.strictEqual(row!.status, 'published', `${row!.errorCode}: ${row!.error}`)
    assert.ok(row!.publishedAt)
    assert.ok(
      buffer.calls.some(c => c.operation === 'Post'),
      'followed on Buffer'
    )
  })

  it('an expired access token is refreshed first, and the new refresh token replaces the spent one', async () => {
    const before = await bufferRow(a.userId)
    const spent = decryptToken(before.refreshToken!, tokenKey, a.userId)
    await expireAccessToken(a.userId)

    const result = await publishNow(a)
    assert.strictEqual(result.status, 'published', String(result.error))
    assert.strictEqual(buffer.refreshes, 1)

    const after = await bufferRow(a.userId)
    const access = decryptToken(after.accessToken!, tokenKey, a.userId)
    const refresh = decryptToken(after.refreshToken!, tokenKey, a.userId)
    assert.notStrictEqual(refresh, spent)
    assert.ok(after.accessTokenExpiresAt!.getTime() > Date.now())
    assert.strictEqual(buffer.creates()[0]!.auth, `Bearer ${access}`)
  })

  it('concurrent requests refresh once: the others wait and use the new token', async () => {
    await expireAccessToken(a.userId)
    buffer.refreshDelayMs = 150
    const row = await bufferRow(a.userId)
    const owner = { connectionId: row.id, userId: a.userId }
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        usableBufferToken(database, config, owner, buffer.fetchFn)
      )
    )
    assert.strictEqual(
      buffer.refreshes,
      1,
      'one refresh request reached Buffer'
    )
    assert.strictEqual(new Set(results.map(r => r.accessToken)).size, 1)
    // The grant was not revoked by a second use of the spent token.
    assert.strictEqual((await bufferRow(a.userId)).status, 'connected')
    assert.strictEqual((await publishNow(a)).status, 'published')
  })

  it('a refused refresh marks Buffer and every network through it expired; publishing says reconnect', async () => {
    // The refresh token Buffer knows was spent elsewhere: the grant is gone.
    const row = await bufferRow(a.userId)
    await buffer.fetchFn(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: decryptToken(row.refreshToken!, tokenKey, a.userId)
      })
    })
    await expireAccessToken(a.userId)

    const result = await publishNow(a)
    assert.strictEqual(
      result.status,
      'failed',
      `${result.status} ${result.errorCode} ${result.error}`
    )
    assert.strictEqual(result.errorCode, 'reauth_required')
    assert.strictEqual((await bufferRow(a.userId)).status, 'expired')
    for (const platform of ['x', 'facebook', 'instagram'] as const) {
      assert.strictEqual(
        (await getConnection(database, a.accountId, platform))!.status,
        'expired',
        platform
      )
    }
    assert.strictEqual(buffer.creates().length, 0)
  })

  it('reconnecting the same Buffer account brings every network back, channel kept', async () => {
    const { linked } = await connect(a, 'ACC-A')
    assert.deepStrictEqual(linked, [], 'nothing new to set up')
    const x = (await getConnection(database, a.accountId, 'x'))!
    assert.strictEqual(x.status, 'connected')
    assert.strictEqual(x.memberId, 'X1')
    assert.strictEqual((await publishNow(a)).status, 'published')
  })

  it('a token Buffer revoked (401 while publishing) expires the Buffer connection', async () => {
    const row = await bufferRow(a.userId)
    buffer.revokeAccess(decryptToken(row.accessToken!, tokenKey, a.userId))
    const result = await publishNow(a)
    assert.strictEqual(result.errorCode, 'reauth_required')
    assert.strictEqual((await bufferRow(a.userId)).status, 'expired')
    assert.strictEqual(
      (await getConnection(database, a.accountId, 'x'))!.status,
      'expired'
    )
    await connect(a, 'ACC-A')
  })

  it('picking another channel cancels the scheduled posts; a channel of another network, or a locked one, is refused', async () => {
    const scheduled = await scheduleX(a)
    const row = await linkBufferChannel(
      database,
      { userId: a.userId, identityId: a.accountId },
      'x',
      'X2'
    )
    assert.strictEqual(row.memberId, 'X2')
    assert.strictEqual(row.autoPublish, false)
    assert.strictEqual(await publicationStatus(scheduled.id), 'cancelled')

    const refused = (channel: string, platform: 'x' | 'instagram') =>
      linkBufferChannel(
        database,
        { userId: a.userId, identityId: a.accountId },
        platform,
        channel
      ).catch(e => e)
    assert.ok((await refused('F1', 'x')) instanceof ConnectionError)
    assert.match((await refused('I1', 'instagram')).message, /locked in Buffer/)
    assert.match(
      (await refused('NOPE', 'x')).message,
      /not in your Buffer account/
    )

    // The same channel again changes nothing and cancels nothing.
    const kept = await scheduleX(a)
    await linkBufferChannel(
      database,
      { userId: a.userId, identityId: a.accountId },
      'x',
      'X2'
    )
    assert.strictEqual(await publicationStatus(kept.id), 'scheduled')
    await database
      .delete(schema.publicationsTable)
      .where(eq(schema.publicationsTable.id, kept.id))
  })

  it('syncing adds new channels, marks removed ones, renames the networks, and is throttled', async () => {
    buffer.setAccount('ACC-A', [
      { id: 'X1', name: 'qa_one', service: 'twitter' },
      {
        id: 'X2',
        name: 'qa_two',
        displayName: 'QA Two Renamed',
        service: 'twitter'
      },
      { id: 'I2', name: 'qa.ig', service: 'instagram' },
      { id: 'I3', name: 'new.ig', service: 'instagram' }
    ])
    const result = await syncBufferChannels(
      database,
      config,
      { userId: a.userId, identityId: a.accountId },
      { platforms: PLATFORMS, fetchFn: buffer.fetchFn, force: true }
    )
    assert.strictEqual(result.synced, true)
    const summary = (await getBufferSummary(database, a.userId))!
    assert.deepStrictEqual(summary.channels.map(c => c.channelId).sort(), [
      'I2',
      'I3',
      'X1',
      'X2'
    ])
    // Removed in Buffer: kept with removed_at, not listed.
    const [f1] = await database
      .select()
      .from(schema.bufferChannelsTable)
      .where(
        and(
          eq(schema.bufferChannelsTable.userId, a.userId),
          eq(schema.bufferChannelsTable.channelId, 'F1')
        )
      )
    assert.ok(f1!.removedAt)
    // The network publishing to a renamed channel follows its name.
    assert.strictEqual(
      (await getConnection(database, a.accountId, 'x'))!.name,
      'QA Two Renamed'
    )
    // Facebook's channel is gone, but syncing alone never disconnects it.
    assert.strictEqual(
      (await getConnection(database, a.accountId, 'facebook'))!.status,
      'connected'
    )

    const again = await syncBufferChannels(
      database,
      config,
      { userId: a.userId, identityId: a.accountId },
      { platforms: PLATFORMS, fetchFn: buffer.fetchFn }
    )
    assert.strictEqual(
      again.synced,
      false,
      'within 30 s: nothing asked of Buffer'
    )
  })

  it("user isolation: nobody publishes through, or picks channels of, another user's Buffer account", async () => {
    const b = await newUser('b')
    const aConnection = await bufferRow(a.userId)
    // Not connected: A's channel cannot be picked.
    const refused = await linkBufferChannel(
      database,
      { userId: b.userId, identityId: b.accountId },
      'x',
      'X1'
    ).catch(e => e)
    assert.ok(refused instanceof ConnectionError)

    // A row tampered to point at A's Buffer connection still cannot publish as A.
    await database.insert(schema.platformConnectionsTable).values({
      userId: b.userId,
      accountId: b.accountId,
      platform: 'x',
      memberId: 'X1',
      bufferConnectionId: aConnection.id,
      scopes: SCOPES
    })
    const result = await publishNow(b)
    assert.strictEqual(result.errorCode, 'not_connected')
    assert.strictEqual(buffer.creates().length, 0)
    await database
      .delete(schema.platformConnectionsTable)
      .where(eq(schema.platformConnectionsTable.userId, b.userId))

    // B connects their own Buffer account: only its channels are theirs.
    const { linked } = await connect(b, 'ACC-B')
    assert.deepStrictEqual(linked, ['x'])
    assert.strictEqual(
      (await getConnection(database, b.accountId, 'x'))!.memberId,
      'XB'
    )
    const notTheirs = await linkBufferChannel(
      database,
      { userId: b.userId, identityId: b.accountId },
      'x',
      'X1'
    ).catch(e => e)
    assert.match(notTheirs.message, /not in your Buffer account/)
    assert.strictEqual((await publishNow(b)).status, 'published')
    assert.match(buffer.creates()[0]!.auth, /^Bearer AT-ACC-B-/)
    assert.strictEqual(buffer.creates()[0]!.variables.input.channelId, 'XB')
    // A is untouched.
    assert.strictEqual((await bufferRow(a.userId)).bufferAccountId, 'ACC-A')
  })

  it('an older API-key connection moves onto Buffer when its channel is there, keeping its schedule; others keep their key', async () => {
    const c = await newUser('c')
    const apiKey = 'BUFFER-API-KEY-1234567890'
    const legacy = (platform: 'x' | 'facebook', channel: string) =>
      insertLegacyConnection(
        database,
        config.encryptionKey,
        { userId: c.userId, accountId: c.accountId },
        platform,
        { memberId: channel, name: channel },
        apiKey
      )
    await legacy('x', 'X2')
    await legacy('facebook', 'F-ELSEWHERE')
    await database
      .update(schema.platformConnectionsTable)
      .set({ autoPublish: true, autoPublishEnabledAt: new Date() })
      .where(eq(schema.platformConnectionsTable.userId, c.userId))
    const scheduled = await scheduleX(c)

    await connect(c, 'ACC-A')
    const x = (await getConnection(database, c.accountId, 'x'))!
    assert.ok(x.bufferConnectionId, 'moved onto the Buffer connection')
    assert.strictEqual(x.accessToken, null, 'the API key is gone')
    assert.strictEqual(x.memberId, 'X2')
    assert.strictEqual(
      x.autoPublish,
      true,
      'same channel: auto-publishing stays on'
    )
    assert.strictEqual(await publicationStatus(scheduled.id), 'scheduled')

    const facebook = (await getConnection(database, c.accountId, 'facebook'))!
    assert.strictEqual(
      facebook.bufferConnectionId,
      null,
      'its channel is not in this Buffer account'
    )
    assert.ok(facebook.accessToken, 'it keeps publishing with its own key')
  })

  it('connecting a different Buffer account disconnects the networks whose channel is not in it', async () => {
    const scheduled = await scheduleX(a)
    buffer.setAccount('ACC-A2', [
      { id: 'X9', name: 'other', service: 'twitter' }
    ])
    await connect(a, 'ACC-A2')
    // Its channel (X2) is not in the new account: the old X connection was
    // disconnected, its schedule cancelled...
    assert.strictEqual(await publicationStatus(scheduled.id), 'cancelled')
    // ...then, for the identity that connected, set up on the new account's
    // channel, with auto-publishing off until turned on knowingly.
    const x = (await getConnection(database, a.accountId, 'x'))!
    assert.strictEqual(x.memberId, 'X9')
    assert.strictEqual(x.status, 'connected')
    assert.strictEqual(x.autoPublish, false)
    // Networks with no channel in the new account stay disconnected.
    assert.strictEqual(
      (await getConnection(database, a.accountId, 'instagram'))!.status,
      'disconnected'
    )
    const summary = (await getBufferSummary(database, a.userId))!
    assert.deepStrictEqual(
      summary.channels.map(c => c.channelId),
      ['X9']
    )
  })

  it('disconnecting Buffer deletes the tokens and channels and stops every network', async () => {
    await linkBufferChannel(
      database,
      { userId: a.userId, identityId: a.accountId },
      'x',
      'X9'
    )
    const scheduled = await scheduleX(a)
    const result = await disconnectBuffer(database, a.userId)
    assert.ok(result && result.cancelled >= 1)

    const row = await bufferRow(a.userId)
    assert.strictEqual(row.status, 'disconnected')
    assert.strictEqual(row.accessToken, null)
    assert.strictEqual(row.refreshToken, null)
    const channels = await database
      .select()
      .from(schema.bufferChannelsTable)
      .where(eq(schema.bufferChannelsTable.connectionId, row.id))
    assert.strictEqual(channels.length, 0)
    assert.strictEqual(await publicationStatus(scheduled.id), 'cancelled')
    for (const platform of ['x', 'facebook', 'instagram'] as const) {
      const connection = await getConnection(database, a.accountId, platform)
      assert.ok(!connection || connection.status === 'disconnected', platform)
    }
    const refusal = await requestPublication(database, {
      userId: a.userId,
      draftId: await xPost(a.accountId),
      trigger: 'manual',
      scheduledAt: new Date()
    }).catch(e => e)
    assert.ok(refusal instanceof PublishRequestError)
    assert.strictEqual(refusal.code, 'not_connected')
    assert.strictEqual(
      await disconnectBuffer(database, a.userId),
      null,
      'twice is a no-op'
    )
  })
})
