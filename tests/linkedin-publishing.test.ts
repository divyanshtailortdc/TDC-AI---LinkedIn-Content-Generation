import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import {
  disconnect,
  getConnection,
  saveConnection
} from '../src/lib/linkedin/connection'
import type { LinkedInAppConfig, TokenSet } from '../src/lib/linkedin/oauth'
import {
  cancelPublication,
  claimPublication,
  deletePublishedPost,
  executePublication,
  type PostImage,
  PublishRequestError,
  queueAutoPublications,
  recoverStalePublications,
  requestPublication,
  runDuePublications,
  STALE_LOCK_MS
} from '../src/lib/linkedin/publishing'

/**
 * Publishing against a real database, with LinkedIn replaced by a stub. Runs
 * only when DATABASE_URL is set in the environment (never from .env, which
 * may be a shared database); every row it makes is removed.
 */

const url = process.env.DATABASE_URL
const tag = `qa-li-${Date.now().toString(36)}`

const config: LinkedInAppConfig = {
  clientId: 'client',
  clientSecret: 'secret',
  redirectUri: 'https://app.example.com/api/linkedin/callback',
  scopes: ['openid', 'profile', 'w_member_social'],
  apiVersion: '202610',
  encryptionKey: randomBytes(32)
}

type Call = {
  method: string
  url: string
  body?: any
  auth?: string
  restliMethod?: string
}

/** A stand-in for LinkedIn: records calls, answers posts from a queue. */
function fakeLinkedIn() {
  const calls: Call[] = []
  let postResponses: Array<() => Response> = []
  let deleteResponses: Array<() => Response> = []
  let postCount = 0
  const fetchFn = (async (input: string | URL, init: RequestInit = {}) => {
    const href = String(input)
    const headers = (init.headers ?? {}) as Record<string, string>
    calls.push({
      method: init.method ?? 'GET',
      url: href,
      auth: headers.Authorization,
      restliMethod: headers['X-RestLi-Method'],
      body:
        typeof init.body === 'string' && init.body.startsWith('{')
          ? JSON.parse(init.body)
          : undefined
    })
    if (init.method === 'DELETE' && href.includes('/rest/posts/')) {
      const next = deleteResponses.shift()
      return next ? next() : new Response(null, { status: 204 })
    }
    if (href.endsWith('/rest/posts')) {
      const next = postResponses.shift()
      if (next) return next()
      postCount++
      return new Response(null, {
        status: 201,
        headers: { 'x-restli-id': `urn:li:share:${postCount}` }
      })
    }
    if (href.includes('/rest/images?action=initializeUpload')) {
      return Response.json({
        value: {
          uploadUrl: 'https://upload.example/img',
          image: 'urn:li:image:IMG1'
        }
      })
    }
    if (href === 'https://upload.example/img')
      return new Response(null, { status: 201 })
    if (href.includes('/comments')) {
      return new Response(null, {
        status: 201,
        headers: { 'x-restli-id': 'urn:li:comment:1' }
      })
    }
    if (href.includes('/oauth/v2/accessToken')) {
      return Response.json({ access_token: 'REFRESHED', expires_in: 5184000 })
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return {
    fetchFn,
    calls,
    postCalls: () => calls.filter(c => c.url.endsWith('/rest/posts')),
    deleteCalls: () => calls.filter(c => c.method === 'DELETE'),
    failNextPosts: (...responses: Array<() => Response>) => {
      postResponses = responses
    },
    answerNextDeletes: (...responses: Array<() => Response>) => {
      deleteResponses = responses
    }
  }
}

const tokens = (overrides: Partial<TokenSet> = {}): TokenSet => ({
  accessToken: `AT-${randomBytes(4).toString('hex')}`,
  accessTokenExpiresAt: new Date(Date.now() + 60 * 24 * 3600_000),
  refreshToken: null,
  refreshTokenExpiresAt: null,
  scopes: ['openid', 'profile', 'w_member_social'],
  ...overrides
})

describe('LinkedIn publishing', { skip: !url }, () => {
  const client = postgres(url!, { max: 4, prepare: false })
  const database = drizzle(client, { schema })
  let linkedIn = fakeLinkedIn()
  const deps = (
    extra: {
      now?: () => Date
      loadImage?: () => Promise<PostImage | null>
    } = {}
  ) => ({
    database,
    config,
    fetchFn: linkedIn.fetchFn,
    loadImage: extra.loadImage ?? (async () => null),
    now: extra.now
  })

  /** A user who signed in with `provider`, with an identity. */
  const newUser = async (name: string, provider: 'google' | 'linkedin') => {
    const [user] = await database
      .insert(schema.authUsersTable)
      .values({
        name,
        email: `${tag}-${name}@example.com`,
        emailVerified: true
      })
      .returning()
    // The sign-in account Better Auth keeps; for LinkedIn it even has a token.
    await database.insert(schema.authAccountsTable).values({
      userId: user!.id,
      providerId: provider,
      accountId: `${provider}-${name}`,
      accessToken: provider === 'linkedin' ? 'SIGN-IN-TOKEN' : null,
      scope:
        provider === 'linkedin'
          ? 'openid,profile,email'
          : 'openid email profile'
    })
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

  const newPost = async (
    accountId: string,
    overrides: Partial<schema.NewPostDraft> = {}
  ) => {
    const [draft] = await database
      .insert(schema.postDraftsTable)
      .values({
        accountId,
        hook: 'A hook',
        // The hook is sent in Unicode bold; the body as written.
        body: 'The body (with brackets) #QA',
        originalHook: 'A hook',
        originalBody: 'The body',
        firstComment: 'First comment',
        status: 'approved',
        ...overrides
      })
      .returning()
    return draft!.id
  }

  const connect = (userId: string, memberId: string, t = tokens()) =>
    saveConnection(database, config, userId, t, {
      memberId,
      name: `Member ${memberId}`,
      pictureUrl: null
    })

  const publishNow = async (userId: string, draftId: string, d = deps()) => {
    const row = await requestPublication(database, {
      userId,
      draftId,
      trigger: 'manual',
      scheduledAt: new Date()
    })
    const claimed = await claimPublication(database, row.id)
    assert.ok(claimed, 'claimed')
    return executePublication(d, claimed)
  }

  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise
    } catch (err) {
      assert.ok(err instanceof PublishRequestError, String(err))
      return err.code
    }
    assert.fail('expected a refusal')
  }

  let a: { userId: string; accountId: string } // signs in with Google
  let b: { userId: string; accountId: string } // signs in with LinkedIn

  before(async () => {
    a = await newUser('a', 'google')
    b = await newUser('b', 'linkedin')
  })
  beforeEach(() => {
    linkedIn = fakeLinkedIn()
  })
  after(async () => {
    await client`delete from auth_users where email like ${`${tag}-%`}`
    await client.end()
  })

  it('3. a signed-in user without a connection cannot publish', async () => {
    const draft = await newPost(a.accountId)
    assert.strictEqual(
      await codeOf(publishNow(a.userId, draft)),
      'not_connected'
    )
    assert.strictEqual(linkedIn.calls.length, 0)
  })

  it('1. Google sign-in, connect LinkedIn, publish', async () => {
    const before = await database
      .select()
      .from(schema.authAccountsTable)
      .where(eq(schema.authAccountsTable.userId, a.userId))
    const t = tokens()
    await connect(a.userId, 'MEMBER_A', t)

    // Stored encrypted; sign-in accounts untouched.
    const [raw] =
      await client`select access_token from linkedin_connections where user_id = ${a.userId}`
    assert.ok(raw!.access_token && !raw!.access_token.includes(t.accessToken))
    const afterConnect = await database
      .select()
      .from(schema.authAccountsTable)
      .where(eq(schema.authAccountsTable.userId, a.userId))
    assert.deepStrictEqual(afterConnect, before)

    const draft = await newPost(a.accountId)
    const result = await publishNow(a.userId, draft)
    assert.strictEqual(result.status, 'published')
    assert.strictEqual(result.linkedinPostUrn, 'urn:li:share:1')
    assert.strictEqual(result.authorUrn, 'urn:li:person:MEMBER_A')
    assert.ok(result.publishedAt)

    const [post] = linkedIn.postCalls()
    assert.strictEqual(post!.auth, `Bearer ${t.accessToken}`)
    assert.strictEqual(post!.body.author, 'urn:li:person:MEMBER_A')
    assert.ok(post!.body.commentary.includes('\\(with brackets\\)'))
    assert.ok(post!.body.commentary.includes('{hashtag|\\#|QA}'))
    assert.ok(
      linkedIn.calls.some(c => c.url.includes('/comments')),
      'first comment added'
    )

    const [saved] = await database
      .select()
      .from(schema.postDraftsTable)
      .where(eq(schema.postDraftsTable.id, draft))
    assert.ok(saved!.postedAt, 'marked posted')
    assert.ok(saved!.plannedFor, 'placed on the calendar')
  })

  it('2. LinkedIn sign-in is not a publishing connection; connecting separately is', async () => {
    assert.strictEqual(await getConnection(database, b.userId), null)
    const draft = await newPost(b.accountId)
    assert.strictEqual(
      await codeOf(publishNow(b.userId, draft)),
      'not_connected'
    )

    await connect(b.userId, 'MEMBER_B')
    const result = await publishNow(b.userId, draft)
    assert.strictEqual(result.status, 'published')
    assert.strictEqual(
      linkedIn.postCalls()[0]!.body.author,
      'urn:li:person:MEMBER_B'
    )
    // The sign-in token was never used.
    assert.ok(linkedIn.calls.every(c => c.auth !== 'Bearer SIGN-IN-TOKEN'))
  })

  it("12. user A cannot publish B's post, nor through B's connection", async () => {
    const bDraft = await newPost(b.accountId)
    assert.strictEqual(await codeOf(publishNow(a.userId, bDraft)), 'not_found')

    // Even a row forged straight into the database is refused when it runs.
    const [forged] = await database
      .insert(schema.linkedinPublicationsTable)
      .values({
        userId: a.userId,
        draftId: bDraft,
        trigger: 'manual',
        scheduledAt: new Date(),
        nextAttemptAt: new Date()
      })
      .returning()
    const claimed = await claimPublication(database, forged!.id)
    const result = await executePublication(deps(), claimed!)
    assert.strictEqual(result.status, 'failed')
    assert.strictEqual(linkedIn.postCalls().length, 0)

    // Nor can A cancel B's publication.
    const bRow = await requestPublication(database, {
      userId: b.userId,
      draftId: await newPost(b.accountId),
      trigger: 'scheduled',
      scheduledAt: new Date(Date.now() + 3600_000)
    })
    assert.strictEqual(
      await cancelPublication(database, a.userId, bRow.id),
      null
    )
    assert.ok(await cancelPublication(database, b.userId, bRow.id))
  })

  it('only approved, unposted posts can be published, once', async () => {
    const review = await newPost(a.accountId, { status: 'awaiting_review' })
    assert.strictEqual(
      await codeOf(publishNow(a.userId, review)),
      'not_approved'
    )
    const posted = await newPost(a.accountId, { postedAt: new Date() })
    assert.strictEqual(
      await codeOf(publishNow(a.userId, posted)),
      'already_posted'
    )

    const draft = await newPost(a.accountId)
    await publishNow(a.userId, draft)
    // Undoing "posted" on Schedule must not allow publishing it again.
    await database
      .update(schema.postDraftsTable)
      .set({ postedAt: null })
      .where(eq(schema.postDraftsTable.id, draft))
    assert.strictEqual(
      await codeOf(publishNow(a.userId, draft)),
      'already_queued'
    )
  })

  it('a post rejected after it was scheduled is not published', async () => {
    const draft = await newPost(a.accountId)
    const row = await requestPublication(database, {
      userId: a.userId,
      draftId: draft,
      trigger: 'scheduled',
      scheduledAt: new Date(Date.now() + 120_000)
    })
    await database
      .update(schema.postDraftsTable)
      .set({ status: 'rejected' })
      .where(eq(schema.postDraftsTable.id, draft))
    const later = new Date(Date.now() + 180_000)
    const claimed = await claimPublication(database, row.id, later)
    const result = await executePublication(
      deps({ now: () => later }),
      claimed!
    )
    assert.strictEqual(result.status, 'failed')
    assert.strictEqual(result.errorCode, 'not_approved')
    assert.strictEqual(linkedIn.postCalls().length, 0)
  })

  it('uploads the image and attaches it to the post', async () => {
    const draft = await newPost(a.accountId)
    const result = await publishNow(
      a.userId,
      draft,
      deps({
        loadImage: async () => ({
          bytes: Buffer.from('png'),
          mediaType: 'image/png',
          altText: 'A chart'
        })
      })
    )
    assert.strictEqual(result.status, 'published')
    const media = linkedIn.postCalls()[0]!.body.content.media
    assert.deepStrictEqual(media, {
      id: 'urn:li:image:IMG1',
      altText: 'A chart'
    })
  })

  it('9. a LinkedIn error fails the publication with its reason, not retried', async () => {
    linkedIn.failNextPosts(() =>
      Response.json({ message: 'commentary too long' }, { status: 422 })
    )
    const draft = await newPost(a.accountId)
    const result = await publishNow(a.userId, draft)
    assert.strictEqual(result.status, 'failed')
    assert.strictEqual(result.errorCode, 'rejected_by_linkedin')
    assert.match(result.error!, /commentary too long/)
    await runDuePublications(
      deps({ now: () => new Date(Date.now() + 3600_000) })
    )
    assert.strictEqual(linkedIn.postCalls().length, 1)
  })

  it('10. a scheduled post is published when due, not before', async () => {
    const draft = await newPost(a.accountId)
    const at = new Date(Date.now() + 5 * 60_000)
    const row = await requestPublication(database, {
      userId: a.userId,
      draftId: draft,
      trigger: 'scheduled',
      scheduledAt: at
    })
    await runDuePublications(
      deps({ now: () => new Date(at.getTime() - 60_000) })
    )
    assert.strictEqual(linkedIn.postCalls().length, 0)

    await runDuePublications(
      deps({ now: () => new Date(at.getTime() + 1_000) })
    )
    const [done] = await database
      .select()
      .from(schema.linkedinPublicationsTable)
      .where(eq(schema.linkedinPublicationsTable.id, row.id))
    assert.strictEqual(done!.status, 'published')
    assert.strictEqual(linkedIn.postCalls().length, 1)
  })

  it('refuses a time in the past', async () => {
    const draft = await newPost(a.accountId)
    assert.strictEqual(
      await codeOf(
        requestPublication(database, {
          userId: a.userId,
          draftId: draft,
          trigger: 'scheduled',
          scheduledAt: new Date(Date.now() - 1000)
        })
      ),
      'invalid_time'
    )
  })

  it('11. retries a failure that published nothing, exactly once more', async () => {
    linkedIn.failNextPosts(() => new Response(null, { status: 503 }))
    const draft = await newPost(a.accountId)
    const first = await publishNow(a.userId, draft)
    assert.strictEqual(first.status, 'scheduled')
    assert.strictEqual(first.errorCode, 'linkedin_unavailable')
    assert.strictEqual(first.attempts, 1)

    const later = new Date(first.nextAttemptAt.getTime() + 1_000)
    await runDuePublications(deps({ now: () => later }))
    await runDuePublications(
      deps({ now: () => new Date(later.getTime() + 3600_000) })
    )
    const rows = await database
      .select()
      .from(schema.linkedinPublicationsTable)
      .where(eq(schema.linkedinPublicationsTable.draftId, draft))
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0]!.status, 'published')
    assert.strictEqual(rows[0]!.attempts, 2)
    // One refused request, one that created the post.
    assert.strictEqual(linkedIn.postCalls().length, 2)
  })

  it('11. never retries a failure that may have published the post', async () => {
    linkedIn.failNextPosts(() => new Response(null, { status: 500 }))
    const draft = await newPost(a.accountId)
    const first = await publishNow(a.userId, draft)
    assert.strictEqual(first.status, 'failed')
    assert.strictEqual(first.errorCode, 'unknown_outcome')
    for (const hours of [1, 2, 3]) {
      await runDuePublications(
        deps({ now: () => new Date(Date.now() + hours * 3600_000) })
      )
    }
    assert.strictEqual(linkedIn.postCalls().length, 1)

    // Neither publishing now nor scheduling it again is allowed until the
    // user confirms it is not on LinkedIn.
    assert.strictEqual(
      await codeOf(publishNow(a.userId, draft)),
      'confirm_unknown_outcome'
    )
    const later = new Date(Date.now() + 3600_000)
    assert.strictEqual(
      await codeOf(
        requestPublication(database, {
          userId: a.userId,
          draftId: draft,
          trigger: 'scheduled',
          scheduledAt: later
        })
      ),
      'confirm_unknown_outcome'
    )
    const confirmed = await requestPublication(database, {
      userId: a.userId,
      draftId: draft,
      trigger: 'scheduled',
      scheduledAt: later,
      confirmedNotPublished: true
    })
    assert.strictEqual(confirmed.status, 'scheduled')
  })

  it('11. two workers claiming the same publication: only one wins', async () => {
    const draft = await newPost(a.accountId)
    const row = await requestPublication(database, {
      userId: a.userId,
      draftId: draft,
      trigger: 'manual',
      scheduledAt: new Date()
    })
    const claims = await Promise.all([
      claimPublication(database, row.id),
      claimPublication(database, row.id),
      claimPublication(database, row.id)
    ])
    assert.strictEqual(claims.filter(Boolean).length, 1)
  })

  it('11. a double click queues the post once', async () => {
    const draft = await newPost(a.accountId)
    const request = () =>
      requestPublication(database, {
        userId: a.userId,
        draftId: draft,
        trigger: 'manual',
        scheduledAt: new Date()
      })
    const results = await Promise.allSettled([request(), request()])
    assert.strictEqual(results.filter(r => r.status === 'fulfilled').length, 1)
  })

  it('11. an interrupted publication is requeued only if the post was never sent', async () => {
    const make = async (sent: boolean) => {
      const draft = await newPost(a.accountId)
      const [row] = await database
        .insert(schema.linkedinPublicationsTable)
        .values({
          userId: a.userId,
          draftId: draft,
          trigger: 'manual',
          status: 'publishing',
          attempts: 1,
          scheduledAt: new Date(),
          nextAttemptAt: new Date(),
          lockedAt: new Date(Date.now() - STALE_LOCK_MS - 60_000),
          metadata: sent ? { postRequestedAt: new Date().toISOString() } : {}
        })
        .returning()
      return row!.id
    }
    const sent = await make(true)
    const notSent = await make(false)
    await recoverStalePublications(database)
    const rows = await database
      .select()
      .from(schema.linkedinPublicationsTable)
      .where(inArray(schema.linkedinPublicationsTable.id, [sent, notSent]))
    const byId = new Map(rows.map(r => [r.id, r]))
    assert.strictEqual(byId.get(sent)!.status, 'failed')
    assert.strictEqual(byId.get(sent)!.errorCode, 'unknown_outcome')
    assert.strictEqual(byId.get(notSent)!.status, 'scheduled')
  })

  it('8. an expired token marks the connection expired and fails the post', async () => {
    const c = await newUser('c', 'google')
    await connect(
      c.userId,
      'MEMBER_C',
      tokens({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
    )
    const draft = await newPost(c.accountId)
    const result = await publishNow(c.userId, draft)
    assert.strictEqual(result.status, 'failed')
    assert.strictEqual(result.errorCode, 'reauth_required')
    assert.strictEqual(
      (await getConnection(database, c.userId))!.status,
      'expired'
    )
    assert.strictEqual(linkedIn.postCalls().length, 0)
    // Expired: nothing new can be queued until reconnecting.
    assert.strictEqual(
      await codeOf(publishNow(c.userId, await newPost(c.accountId))),
      'reauth_required'
    )
  })

  it('8. a token LinkedIn revoked (401) marks the connection expired', async () => {
    const d = await newUser('d', 'google')
    await connect(d.userId, 'MEMBER_D')
    linkedIn.failNextPosts(() => new Response(null, { status: 401 }))
    const result = await publishNow(d.userId, await newPost(d.accountId))
    assert.strictEqual(result.errorCode, 'reauth_required')
    assert.strictEqual(
      (await getConnection(database, d.userId))!.status,
      'expired'
    )
  })

  it('8. an expired token is refreshed when LinkedIn gave a refresh token', async () => {
    const e = await newUser('e', 'google')
    await connect(
      e.userId,
      'MEMBER_E',
      tokens({
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshToken: 'RT',
        refreshTokenExpiresAt: new Date(Date.now() + 3600_000)
      })
    )
    const result = await publishNow(e.userId, await newPost(e.accountId))
    assert.strictEqual(result.status, 'published')
    assert.strictEqual(linkedIn.postCalls()[0]!.auth, 'Bearer REFRESHED')
  })

  it('4. disconnecting removes the tokens and cancels scheduled posts', async () => {
    const f = await newUser('f', 'linkedin')
    await connect(f.userId, 'MEMBER_F')
    const row = await requestPublication(database, {
      userId: f.userId,
      draftId: await newPost(f.accountId),
      trigger: 'scheduled',
      scheduledAt: new Date(Date.now() + 3600_000)
    })
    assert.deepStrictEqual(await disconnect(database, f.userId), {
      cancelled: 1
    })
    const connection = await getConnection(database, f.userId)
    assert.strictEqual(connection!.status, 'disconnected')
    assert.strictEqual(connection!.accessToken, null)
    const [cancelled] = await database
      .select()
      .from(schema.linkedinPublicationsTable)
      .where(eq(schema.linkedinPublicationsTable.id, row.id))
    assert.strictEqual(cancelled!.status, 'cancelled')
    assert.strictEqual(
      await codeOf(publishNow(f.userId, await newPost(f.accountId))),
      'not_connected'
    )
    // Signing in still works: the sign-in account is untouched.
    const signIn = await database
      .select()
      .from(schema.authAccountsTable)
      .where(eq(schema.authAccountsTable.userId, f.userId))
    assert.strictEqual(signIn.length, 1)

    // 5. Reconnecting works again, in the same row.
    const reconnected = await connect(f.userId, 'MEMBER_F')
    assert.strictEqual(reconnected.id, connection!.id)
    assert.strictEqual(reconnected.status, 'connected')
    const result = await publishNow(f.userId, await newPost(f.accountId))
    assert.strictEqual(result.status, 'published')
  })

  it('5. reconnecting as a different LinkedIn member turns auto-publishing off', async () => {
    const g = await newUser('g', 'google')
    await connect(g.userId, 'MEMBER_G')
    await database
      .update(schema.linkedinConnectionsTable)
      .set({ autoPublish: true, autoPublishEnabledAt: new Date() })
      .where(eq(schema.linkedinConnectionsTable.userId, g.userId))
    assert.strictEqual((await connect(g.userId, 'MEMBER_G')).autoPublish, true)
    const scheduled = await requestPublication(database, {
      userId: g.userId,
      draftId: await newPost(g.accountId),
      trigger: 'scheduled',
      scheduledAt: new Date(Date.now() + 3600_000)
    })
    assert.strictEqual(
      (await connect(g.userId, 'MEMBER_OTHER')).autoPublish,
      false
    )
    // Scheduled as MEMBER_G: it must not go out as MEMBER_OTHER.
    const [row] = await database
      .select()
      .from(schema.linkedinPublicationsTable)
      .where(eq(schema.linkedinPublicationsTable.id, scheduled.id))
    assert.strictEqual(row!.status, 'cancelled')
  })

  describe('deleting', () => {
    it('deletes a published post from LinkedIn; it stays published, so it never goes out again', async () => {
      const k = await newUser('k', 'google')
      await connect(k.userId, 'MEMBER_K')
      const draft = await newPost(k.accountId)
      const published = await publishNow(k.userId, draft)

      const deleted = await deletePublishedPost(
        deps(),
        k.userId,
        published.id
      )
      assert.strictEqual(deleted.status, 'published')
      assert.ok(deleted.deletedAt, 'deletedAt set')
      const [call] = linkedIn.deleteCalls()
      assert.strictEqual(
        call!.url,
        `https://api.linkedin.com/rest/posts/${encodeURIComponent(published.linkedinPostUrn!)}`
      )
      assert.strictEqual(call!.restliMethod, 'DELETE')

      // Once deleted, deleting again does not call LinkedIn.
      await deletePublishedPost(deps(), k.userId, published.id)
      assert.strictEqual(linkedIn.deleteCalls().length, 1)
      assert.strictEqual(
        await codeOf(publishNow(k.userId, draft)),
        'already_posted'
      )
    })

    it("only the publisher can delete it, and only as the member it went out as", async () => {
      const l = await newUser('l', 'google')
      const m = await newUser('m', 'google')
      await connect(l.userId, 'MEMBER_L')
      await connect(m.userId, 'MEMBER_M')
      const published = await publishNow(l.userId, await newPost(l.accountId))

      assert.strictEqual(
        await codeOf(deletePublishedPost(deps(), m.userId, published.id)),
        'not_found'
      )
      await connect(l.userId, 'MEMBER_L_OTHER')
      assert.strictEqual(
        await codeOf(deletePublishedPost(deps(), l.userId, published.id)),
        'missing_permission'
      )
      assert.strictEqual(linkedIn.deleteCalls().length, 0)
    })

    it('a LinkedIn error leaves it undeleted; a post LinkedIn no longer has counts as deleted', async () => {
      const n = await newUser('n', 'google')
      await connect(n.userId, 'MEMBER_N')
      const published = await publishNow(n.userId, await newPost(n.accountId))

      linkedIn.answerNextDeletes(
        () => new Response(null, { status: 500 }),
        () => Response.json({ message: 'Not found' }, { status: 404 })
      )
      assert.strictEqual(
        await codeOf(deletePublishedPost(deps(), n.userId, published.id)),
        'linkedin_unavailable'
      )
      const [kept] = await database
        .select()
        .from(schema.linkedinPublicationsTable)
        .where(eq(schema.linkedinPublicationsTable.id, published.id))
      assert.strictEqual(kept!.deletedAt, null)

      const deleted = await deletePublishedPost(deps(), n.userId, published.id)
      assert.ok(deleted.deletedAt, 'a 404 counts as deleted')
    })

    it('deleting the post from the app keeps its publication as the record', async () => {
      const o = await newUser('o', 'google')
      await connect(o.userId, 'MEMBER_O')
      const draft = await newPost(o.accountId)
      const published = await publishNow(o.userId, draft)

      await database
        .delete(schema.postDraftsTable)
        .where(eq(schema.postDraftsTable.id, draft))
      const [record] = await database
        .select()
        .from(schema.linkedinPublicationsTable)
        .where(eq(schema.linkedinPublicationsTable.id, published.id))
      assert.ok(record, 'the publication outlives the post')
      assert.strictEqual(record!.draftId, null)
      assert.strictEqual(record!.status, 'published')
      assert.strictEqual(record!.linkedinPostUrn, published.linkedinPostUrn)
    })
  })

  describe('auto-publishing', () => {
    // 10:00 UTC today; the slot is 09:00 UTC.
    const today = new Date()
    today.setUTCHours(10, 0, 0, 0)
    const day = today.toISOString().slice(0, 10)
    const slot = new Date(`${day}T09:00:00Z`)
    // Approved and planned an hour before the slot.
    const before = new Date(slot.getTime() - 3600_000)

    const setUp = async (name: string, enabledAt: Date) => {
      const u = await newUser(name, 'google')
      await connect(u.userId, `MEMBER_${name}`)
      await database
        .update(schema.linkedinConnectionsTable)
        .set({
          autoPublish: true,
          autoPublishTime: '09:00',
          autoPublishTimezone: 'UTC',
          autoPublishEnabledAt: enabledAt
        })
        .where(eq(schema.linkedinConnectionsTable.userId, u.userId))
      return u
    }

    it("queues only today's approved planned posts, once", async () => {
      const u = await setUp('h', new Date(slot.getTime() - 24 * 3600_000))
      const due = await newPost(u.accountId, {
        plannedFor: day,
        updatedAt: before
      })
      await newPost(u.accountId, {
        plannedFor: day,
        status: 'awaiting_review',
        updatedAt: before
      })
      await newPost(u.accountId, {
        plannedFor: '2000-01-01',
        updatedAt: before
      })
      await newPost(u.accountId, { updatedAt: before })
      // Approved (or planned for today) after the slot: not published at once.
      await newPost(u.accountId, {
        plannedFor: day,
        updatedAt: new Date(slot.getTime() + 30 * 60_000)
      })

      assert.strictEqual(
        await queueAutoPublications(
          database,
          new Date(slot.getTime() - 60_000)
        ),
        0
      )
      const queuedNow = await database
        .select()
        .from(schema.linkedinPublicationsTable)
        .where(eq(schema.linkedinPublicationsTable.userId, u.userId))
      assert.strictEqual(queuedNow.length, 0)

      await queueAutoPublications(database, today)
      await queueAutoPublications(database, today)
      const rows = await database
        .select()
        .from(schema.linkedinPublicationsTable)
        .where(eq(schema.linkedinPublicationsTable.userId, u.userId))
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0]!.draftId, due)
      assert.strictEqual(rows[0]!.trigger, 'auto')
    })

    it('does not sweep up a slot that passed before it was turned on', async () => {
      const u = await setUp('i', new Date(slot.getTime() + 60_000))
      await newPost(u.accountId, { plannedFor: day, updatedAt: before })
      await queueAutoPublications(database, today)
      const rows = await database
        .select()
        .from(schema.linkedinPublicationsTable)
        .where(eq(schema.linkedinPublicationsTable.userId, u.userId))
      assert.strictEqual(rows.length, 0)
    })

    it('never re-queues a post whose earlier publication failed', async () => {
      const u = await setUp('j', new Date(slot.getTime() - 24 * 3600_000))
      const draft = await newPost(u.accountId, {
        plannedFor: day,
        updatedAt: before
      })
      await database.insert(schema.linkedinPublicationsTable).values({
        userId: u.userId,
        draftId: draft,
        trigger: 'auto',
        status: 'failed',
        errorCode: 'unknown_outcome',
        scheduledAt: slot,
        nextAttemptAt: slot
      })
      await queueAutoPublications(database, today)
      const rows = await database
        .select()
        .from(schema.linkedinPublicationsTable)
        .where(
          and(
            eq(schema.linkedinPublicationsTable.draftId, draft),
            eq(schema.linkedinPublicationsTable.status, 'scheduled')
          )
        )
      assert.strictEqual(rows.length, 0)
    })
  })
})
