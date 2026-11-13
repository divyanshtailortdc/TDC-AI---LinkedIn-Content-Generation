import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import postgres from 'postgres'
import sharp from 'sharp'
import * as schema from '../src/db/schema'
import {
  disconnect,
  getConnection,
  saveConnection
} from '../src/lib/publishing/connection'
import type { LinkedInAppConfig, TokenSet } from '../src/lib/publishing/linkedin/oauth'
import { parseMediaSubject, verifyMediaToken } from '../src/lib/publishing/media-token'
import type { BufferConfig } from '../src/lib/publishing/provider'
import {
  cancelPublication,
  claimPublication,
  confirmPendingPublications,
  CONFIRM_TIMEOUT_MS,
  deletePublishedPost,
  executePublication,
  type PostImage,
  PublishRequestError,
  queueAutoPublications,
  recoverStalePublications,
  requestPublication,
  runDuePublications,
  STALE_LOCK_MS
} from '../src/lib/publishing/engine'

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
  redirectUri: 'https://app.example.com/api/integrations/linkedin/callback',
  scopes: ['openid', 'profile', 'w_member_social'],
  apiVersion: '202610',
  encryptionKey: randomBytes(32)
}

const BUFFER_URL = 'https://buffer.example/graphql'

const xConfig: BufferConfig = {
  // Connected with API keys here (the OAuth flow is checked in publishing-units).
  oauth: null,
  apiUrl: BUFFER_URL,
  appUrl: 'https://app.example.com',
  encryptionKey: config.encryptionKey,
  // Publish now does not wait for Buffer in tests.
  inlineWaitMs: 0
}

/**
 * A stand-in for Buffer's GraphQL API: records each operation, answers
 * createPost and post from queues (by default: sent at once).
 */
function fakeBuffer() {
  const calls: Array<{ operation: string; variables: any; auth?: string }> = []
  let createAnswers: Array<() => Response> = []
  let postStates: string[] = []
  let created = 0
  const post = (id: string, status: string) => ({
    id,
    status,
    externalLink: status === 'sent' ? `https://x.com/qa/status/${id}` : null,
    sentAt: status === 'sent' ? new Date().toISOString() : null,
    error: status === 'error' ? { message: 'Duplicate content' } : null
  })
  const fetchFn = (async (_input: string | URL, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body))
    const operation = /(mutation|query)\s+(\w+)/.exec(body.query)?.[2] ?? '?'
    const headers = (init.headers ?? {}) as Record<string, string>
    calls.push({ operation, variables: body.variables, auth: headers.Authorization })
    if (operation === 'CreatePost') {
      const next = createAnswers.shift()
      if (next) return next()
      created++
      return Response.json({
        data: { createPost: { __typename: 'PostActionSuccess', post: post(`B${created}`, 'sent') } }
      })
    }
    if (operation === 'Post') {
      const id = body.variables.input.id
      return Response.json({ data: { post: post(id, postStates.shift() ?? 'sent') } })
    }
    return Response.json({ errors: [{ message: 'unknown', extensions: { code: 'NOT_FOUND' } }] })
  }) as typeof fetch
  return {
    fetchFn,
    calls,
    creates: () => calls.filter(c => c.operation === 'CreatePost'),
    answerNextCreates: (...answers: Array<() => Response>) => {
      createAnswers = answers
    },
    /** What the next looks at a post find, in order (then 'sent'). */
    postStatesNext: (...states: string[]) => {
      postStates = states
    },
    pending: (id: string) => () =>
      Response.json({
        data: { createPost: { __typename: 'PostActionSuccess', post: post(id, 'sending') } }
      })
  }
}

type Call = {
  method: string
  url: string
  body?: any
  /** An upload's raw bytes (an image or a carousel's PDF). */
  bytes?: Buffer
  auth?: string
  restliMethod?: string
}

/** A stand-in for LinkedIn: records calls, answers posts from a queue. */
function fakePlatform() {
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
          : undefined,
      bytes: init.body instanceof Uint8Array ? Buffer.from(init.body) : undefined
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
    if (href.includes('/rest/documents?action=initializeUpload')) {
      return Response.json({
        value: {
          uploadUrl: 'https://upload.example/doc',
          document: 'urn:li:document:DOC1'
        }
      })
    }
    if (href === 'https://upload.example/doc')
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
  let linkedIn = fakePlatform()
  let buffer = fakeBuffer()
  const deps = (
    extra: {
      now?: () => Date
      loadImage?: () => Promise<PostImage | null>
    } = {}
  ) => ({
    database,
    // Facebook and Instagram go through the same Buffer stub as X.
    configs: { linkedin: config, x: xConfig, facebook: xConfig, instagram: xConfig },
    // Buffer's calls to the Buffer stub, everything else to LinkedIn's.
    fetchFn: ((input: string | URL, init?: RequestInit) =>
      String(input) === BUFFER_URL
        ? buffer.fetchFn(input, init)
        : linkedIn.fetchFn(input, init)) as typeof fetch,
    loadImage: extra.loadImage ?? (async () => null),
    now: extra.now
  })

  /** A user and the identity a connection is made for. */
  type Owner = { userId: string; accountId: string }

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

  /** Connects the identity `owner.accountId`, as its owner. */
  const connect = (owner: Owner, memberId: string, t = tokens()) =>
    saveConnection(database, config, owner, t, {
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

  /** A small real PNG, as a drawn slide is stored without a bucket. */
  const slidePng = async () =>
    `data:image/png;base64,${(
      await sharp({
        create: { width: 108, height: 135, channels: 3, background: '#2255aa' }
      })
        .png()
        .toBuffer()
    ).toString('base64')}`

  /** `count` drawn slides on a post; `undrawn` names one that failed to draw. */
  const addSlides = async (draftId: string, count: number, undrawn?: number) => {
    const image = await slidePng()
    for (let i = 1; i <= count; i++) {
      await database.insert(schema.postSlidesTable).values({
        draftId,
        position: i,
        role: i === 1 ? 'cover' : i === count ? 'cta' : 'content',
        headline: i === 1 ? 'Five checks before you sign' : `Slide ${i}`,
        imageUrl: undrawn === i ? null : image,
        renderStatus: undrawn === i ? 'failed' : 'ready',
        altText: `Slide ${i} described`
      })
    }
  }

  let a: { userId: string; accountId: string } // signs in with Google
  let b: { userId: string; accountId: string } // signs in with LinkedIn

  before(async () => {
    a = await newUser('a', 'google')
    b = await newUser('b', 'linkedin')
  })
  beforeEach(() => {
    linkedIn = fakePlatform()
    buffer = fakeBuffer()
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
    await connect(a, 'MEMBER_A', t)

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
    assert.strictEqual(result.externalPostId, 'urn:li:share:1')
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
    assert.strictEqual(await getConnection(database, b.accountId), null)
    const draft = await newPost(b.accountId)
    assert.strictEqual(
      await codeOf(publishNow(b.userId, draft)),
      'not_connected'
    )

    await connect(b, 'MEMBER_B')
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
      .insert(schema.publicationsTable)
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
    assert.strictEqual(result.errorCode, 'rejected_by_platform')
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
      .from(schema.publicationsTable)
      .where(eq(schema.publicationsTable.id, row.id))
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
    assert.strictEqual(first.errorCode, 'platform_unavailable')
    assert.strictEqual(first.attempts, 1)

    const later = new Date(first.nextAttemptAt.getTime() + 1_000)
    await runDuePublications(deps({ now: () => later }))
    await runDuePublications(
      deps({ now: () => new Date(later.getTime() + 3600_000) })
    )
    const rows = await database
      .select()
      .from(schema.publicationsTable)
      .where(eq(schema.publicationsTable.draftId, draft))
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
        .insert(schema.publicationsTable)
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
      .from(schema.publicationsTable)
      .where(inArray(schema.publicationsTable.id, [sent, notSent]))
    const byId = new Map(rows.map(r => [r.id, r]))
    assert.strictEqual(byId.get(sent)!.status, 'failed')
    assert.strictEqual(byId.get(sent)!.errorCode, 'unknown_outcome')
    assert.strictEqual(byId.get(notSent)!.status, 'scheduled')
  })

  it('8. an expired token marks the connection expired and fails the post', async () => {
    const c = await newUser('c', 'google')
    await connect(
      c,
      'MEMBER_C',
      tokens({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
    )
    const draft = await newPost(c.accountId)
    const result = await publishNow(c.userId, draft)
    assert.strictEqual(result.status, 'failed')
    assert.strictEqual(result.errorCode, 'reauth_required')
    assert.strictEqual(
      (await getConnection(database, c.accountId))!.status,
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
    await connect(d, 'MEMBER_D')
    linkedIn.failNextPosts(() => new Response(null, { status: 401 }))
    const result = await publishNow(d.userId, await newPost(d.accountId))
    assert.strictEqual(result.errorCode, 'reauth_required')
    assert.strictEqual(
      (await getConnection(database, d.accountId))!.status,
      'expired'
    )
  })

  it('8. an expired token is refreshed when LinkedIn gave a refresh token', async () => {
    const e = await newUser('e', 'google')
    await connect(
      e,
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
    await connect(f, 'MEMBER_F')
    const row = await requestPublication(database, {
      userId: f.userId,
      draftId: await newPost(f.accountId),
      trigger: 'scheduled',
      scheduledAt: new Date(Date.now() + 3600_000)
    })
    assert.deepStrictEqual(await disconnect(database, f.accountId), {
      cancelled: 1
    })
    const connection = await getConnection(database, f.accountId)
    assert.strictEqual(connection!.status, 'disconnected')
    assert.strictEqual(connection!.accessToken, null)
    const [cancelled] = await database
      .select()
      .from(schema.publicationsTable)
      .where(eq(schema.publicationsTable.id, row.id))
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
    const reconnected = await connect(f, 'MEMBER_F')
    assert.strictEqual(reconnected.id, connection!.id)
    assert.strictEqual(reconnected.status, 'connected')
    const result = await publishNow(f.userId, await newPost(f.accountId))
    assert.strictEqual(result.status, 'published')
  })

  it('5. reconnecting as a different LinkedIn member turns auto-publishing off', async () => {
    const g = await newUser('g', 'google')
    await connect(g, 'MEMBER_G')
    await database
      .update(schema.platformConnectionsTable)
      .set({ autoPublish: true, autoPublishEnabledAt: new Date() })
      .where(eq(schema.platformConnectionsTable.userId, g.userId))
    assert.strictEqual((await connect(g, 'MEMBER_G')).autoPublish, true)
    const scheduled = await requestPublication(database, {
      userId: g.userId,
      draftId: await newPost(g.accountId),
      trigger: 'scheduled',
      scheduledAt: new Date(Date.now() + 3600_000)
    })
    assert.strictEqual(
      (await connect(g, 'MEMBER_OTHER')).autoPublish,
      false
    )
    // Scheduled as MEMBER_G: it must not go out as MEMBER_OTHER.
    const [row] = await database
      .select()
      .from(schema.publicationsTable)
      .where(eq(schema.publicationsTable.id, scheduled.id))
    assert.strictEqual(row!.status, 'cancelled')
  })

  describe('deleting', () => {
    it('deletes a published post from LinkedIn and unlocks it: it can be edited and published again', async () => {
      const k = await newUser('k', 'google')
      await connect(k, 'MEMBER_K')
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
        `https://api.linkedin.com/rest/posts/${encodeURIComponent(published.externalPostId!)}`
      )
      assert.strictEqual(call!.restliMethod, 'DELETE')

      // Once deleted, deleting again does not call LinkedIn.
      await deletePublishedPost(deps(), k.userId, published.id)
      assert.strictEqual(linkedIn.deleteCalls().length, 1)

      // The post is unlocked: no longer posted, still approved, changeable.
      const [post] = await database
        .select()
        .from(schema.postDraftsTable)
        .where(eq(schema.postDraftsTable.id, draft))
      assert.strictEqual(post!.postedAt, null)
      assert.strictEqual(post!.plannedFor, null)
      assert.strictEqual(post!.status, 'approved')
      const { hasLivePublication } = await import(
        '../src/lib/publishing/publication-queries'
      )
      const { assertPostChangeable, PostLockedError } = await import(
        '../src/lib/publishing/post-lock'
      )
      assert.strictEqual(await hasLivePublication(database, draft), false)
      await assertPostChangeable(post!, database)

      // Published again as a new post; the deleted one stays as the record.
      const again = await publishNow(k.userId, draft)
      assert.strictEqual(again.status, 'published')
      assert.notStrictEqual(again.id, published.id)
      assert.strictEqual(linkedIn.postCalls().length, 2)
      const [record] = await database
        .select()
        .from(schema.publicationsTable)
        .where(eq(schema.publicationsTable.id, published.id))
      assert.strictEqual(record!.status, 'published')
      assert.ok(record!.deletedAt, 'the deleted publication keeps its deletedAt')

      // Out again: locked again, and not published a third time.
      const [reposted] = await database
        .select()
        .from(schema.postDraftsTable)
        .where(eq(schema.postDraftsTable.id, draft))
      await assert.rejects(
        assertPostChangeable(reposted!, database),
        PostLockedError
      )
      assert.strictEqual(
        await codeOf(publishNow(k.userId, draft)),
        'already_posted'
      )
    })

    it('the one-live index ignores a publication deleted from its platform', async () => {
      const q = await newUser('live-index', 'google')
      const draft = await newPost(q.accountId)
      const row = (status: 'scheduled' | 'published', deletedAt: Date | null) => ({
        userId: q.userId,
        draftId: draft,
        trigger: 'manual' as const,
        status,
        deletedAt,
        scheduledAt: new Date(),
        nextAttemptAt: new Date()
      })
      await database.insert(schema.publicationsTable).values(row('published', new Date()))
      // A deleted publication leaves room for a new one...
      await database.insert(schema.publicationsTable).values(row('scheduled', null))
      // ...but there is still only one live one at a time.
      await assert.rejects(
        database.insert(schema.publicationsTable).values(row('published', null))
      )
    })

    it("only the publisher can delete it, and only as the member it went out as", async () => {
      const l = await newUser('l', 'google')
      const m = await newUser('m', 'google')
      await connect(l, 'MEMBER_L')
      await connect(m, 'MEMBER_M')
      const published = await publishNow(l.userId, await newPost(l.accountId))

      assert.strictEqual(
        await codeOf(deletePublishedPost(deps(), m.userId, published.id)),
        'not_found'
      )
      await connect(l, 'MEMBER_L_OTHER')
      assert.strictEqual(
        await codeOf(deletePublishedPost(deps(), l.userId, published.id)),
        'missing_permission'
      )
      assert.strictEqual(linkedIn.deleteCalls().length, 0)
    })

    it('a LinkedIn error leaves it undeleted; a post LinkedIn no longer has counts as deleted', async () => {
      const n = await newUser('n', 'google')
      await connect(n, 'MEMBER_N')
      const published = await publishNow(n.userId, await newPost(n.accountId))

      linkedIn.answerNextDeletes(
        () => new Response(null, { status: 500 }),
        () => Response.json({ message: 'Not found' }, { status: 404 })
      )
      assert.strictEqual(
        await codeOf(deletePublishedPost(deps(), n.userId, published.id)),
        'platform_unavailable'
      )
      const [kept] = await database
        .select()
        .from(schema.publicationsTable)
        .where(eq(schema.publicationsTable.id, published.id))
      assert.strictEqual(kept!.deletedAt, null)

      const deleted = await deletePublishedPost(deps(), n.userId, published.id)
      assert.ok(deleted.deletedAt, 'a 404 counts as deleted')
    })

    it('deleting the post from the app keeps its publication as the record', async () => {
      const o = await newUser('o', 'google')
      await connect(o, 'MEMBER_O')
      const draft = await newPost(o.accountId)
      const published = await publishNow(o.userId, draft)

      await database
        .delete(schema.postDraftsTable)
        .where(eq(schema.postDraftsTable.id, draft))
      const [record] = await database
        .select()
        .from(schema.publicationsTable)
        .where(eq(schema.publicationsTable.id, published.id))
      assert.ok(record, 'the publication outlives the post')
      assert.strictEqual(record!.draftId, null)
      assert.strictEqual(record!.status, 'published')
      assert.strictEqual(record!.externalPostId, published.externalPostId)
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
      await connect(u, `MEMBER_${name}`)
      await database
        .update(schema.platformConnectionsTable)
        .set({
          autoPublish: true,
          autoPublishTime: '09:00',
          autoPublishTimezone: 'UTC',
          autoPublishEnabledAt: enabledAt
        })
        .where(eq(schema.platformConnectionsTable.userId, u.userId))
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
        .from(schema.publicationsTable)
        .where(eq(schema.publicationsTable.userId, u.userId))
      assert.strictEqual(queuedNow.length, 0)

      await queueAutoPublications(database, today)
      await queueAutoPublications(database, today)
      const rows = await database
        .select()
        .from(schema.publicationsTable)
        .where(eq(schema.publicationsTable.userId, u.userId))
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
        .from(schema.publicationsTable)
        .where(eq(schema.publicationsTable.userId, u.userId))
      assert.strictEqual(rows.length, 0)
    })

    it('never re-queues a post whose earlier publication failed', async () => {
      const u = await setUp('j', new Date(slot.getTime() - 24 * 3600_000))
      const draft = await newPost(u.accountId, {
        plannedFor: day,
        updatedAt: before
      })
      await database.insert(schema.publicationsTable).values({
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
        .from(schema.publicationsTable)
        .where(
          and(
            eq(schema.publicationsTable.draftId, draft),
            eq(schema.publicationsTable.status, 'scheduled')
          )
        )
      assert.strictEqual(rows.length, 0)
    })

    it('queues a post again once its earlier publication was deleted from its platform', async () => {
      const u = await setUp('dq', new Date(slot.getTime() - 24 * 3600_000))
      const draft = await newPost(u.accountId, {
        plannedFor: day,
        updatedAt: before
      })
      await database.insert(schema.publicationsTable).values({
        userId: u.userId,
        draftId: draft,
        trigger: 'manual',
        status: 'published',
        publishedAt: new Date(before.getTime() - 3600_000),
        deletedAt: new Date(before.getTime() - 1000),
        createdAt: new Date(before.getTime() - 3600_000),
        scheduledAt: slot,
        nextAttemptAt: slot
      })
      await queueAutoPublications(database, today)
      await queueAutoPublications(database, today)
      const rows = await database
        .select()
        .from(schema.publicationsTable)
        .where(
          and(
            eq(schema.publicationsTable.draftId, draft),
            eq(schema.publicationsTable.status, 'scheduled')
          )
        )
      assert.strictEqual(rows.length, 1)
    })

    it("sweeps only its own identity's posts, not the owner's other identity's", async () => {
      const u = await setUp('p', new Date(slot.getTime() - 24 * 3600_000))
      const [persona] = await database
        .insert(schema.accountsTable)
        .values({ userId: u.userId, name: 'Persona', handle: `${tag}-persona`, headline: 'QA' })
        .returning()
      const own = await newPost(u.accountId, { plannedFor: day, updatedAt: before })
      await newPost(persona!.id, { plannedFor: day, updatedAt: before })
      await queueAutoPublications(database, today)
      const rows = await database
        .select()
        .from(schema.publicationsTable)
        .where(eq(schema.publicationsTable.userId, u.userId))
      assert.deepStrictEqual(rows.map(r => r.draftId), [own])
      assert.strictEqual(rows[0]!.accountId, u.accountId)
    })
  })

  describe('several identities', () => {
    it("publishes each identity's posts through its own connection only", async () => {
      const q = await newUser('q', 'google')
      const [persona] = await database
        .insert(schema.accountsTable)
        .values({ userId: q.userId, name: 'Persona', handle: `${tag}-q-persona`, headline: 'QA' })
        .returning()
      const second = { userId: q.userId, accountId: persona!.id }
      await connect(q, 'MEMBER_Q_MAIN')

      // The persona has no LinkedIn of its own: its post is not sent through
      // the main identity's.
      const personaDraft = await newPost(second.accountId)
      assert.strictEqual(await codeOf(publishNow(q.userId, personaDraft)), 'not_connected')

      await connect(second, 'MEMBER_Q_PERSONA')
      const published = await publishNow(q.userId, personaDraft)
      assert.strictEqual(published.status, 'published')
      assert.strictEqual(published.accountId, second.accountId)
      assert.strictEqual(
        linkedIn.postCalls().at(-1)!.body.author,
        'urn:li:person:MEMBER_Q_PERSONA'
      )

      // Disconnecting one identity leaves the other's connection alone.
      await disconnect(database, second.accountId)
      assert.strictEqual((await getConnection(database, q.accountId))!.status, 'connected')
      assert.strictEqual(
        (await getConnection(database, second.accountId))!.status,
        'disconnected'
      )
    })
  })
  describe('carousels', () => {
    let c: Owner
    before(async () => {
      c = await newUser('carousel', 'google')
      await connect(c, 'MEMBER_C')
    })

    it('C1. a LinkedIn carousel goes out as one PDF document, titled by its cover', async () => {
      const draft = await newPost(c.accountId, { mediaFormat: 'carousel' })
      await addSlides(draft, 3)
      const result = await publishNow(c.userId, draft)
      assert.strictEqual(result.status, 'published', String(result.error))

      const upload = linkedIn.calls.find(call => call.url === 'https://upload.example/doc')
      assert.ok(upload, 'the document was uploaded')
      assert.strictEqual(upload.method, 'PUT')
      const pdf = upload.bytes!.toString('latin1')
      assert.ok(pdf.startsWith('%PDF-'), 'a PDF')
      assert.strictEqual(pdf.match(/\/Type\s*\/Page\b/g)?.length, 3, 'one page per slide')
      // No single image goes with it.
      assert.ok(!linkedIn.calls.some(call => call.url.includes('/rest/images')))
      assert.deepStrictEqual(linkedIn.postCalls()[0]!.body.content, {
        media: { id: 'urn:li:document:DOC1', title: 'Five checks before you sign' }
      })
    })

    it('C2. a carousel without slides, with one, or with a slide not drawn is refused before LinkedIn', async () => {
      const none = await newPost(c.accountId, { mediaFormat: 'carousel' })
      assert.strictEqual(await codeOf(publishNow(c.userId, none)), 'needs_image')

      const one = await newPost(c.accountId, { mediaFormat: 'carousel' })
      await addSlides(one, 1)
      assert.strictEqual(await codeOf(publishNow(c.userId, one)), 'needs_image')

      const undrawn = await newPost(c.accountId, { mediaFormat: 'carousel' })
      await addSlides(undrawn, 3, 2)
      assert.strictEqual(await codeOf(publishNow(c.userId, undrawn)), 'needs_image')

      assert.strictEqual(linkedIn.calls.length, 0)
    })

    it('C3. a post set to text only goes out without the image it still has', async () => {
      const draft = await newPost(c.accountId, { mediaFormat: 'text' })
      await database.insert(schema.postMediaTable).values({
        draftId: draft,
        mode: 'ai_generated',
        imageUrl: 'https://img.example/a.png'
      })
      const result = await publishNow(
        c.userId,
        draft,
        deps({
          loadImage: async () => ({
            bytes: Buffer.from('png'),
            mediaType: 'image/png',
            altText: 'A chart'
          })
        })
      )
      assert.strictEqual(result.status, 'published', String(result.error))
      assert.ok(!linkedIn.calls.some(call => call.url.includes('/rest/images')))
      assert.strictEqual(linkedIn.postCalls()[0]!.body.content, undefined)
    })
  })

  describe('X through Buffer', () => {
    let x: { userId: string; accountId: string }
    const apiKey = 'BUFFER-KEY-1234567890'
    const connectX = (owner: Owner, channelId = 'CHANNEL_X', key = apiKey) =>
      saveConnection(
        database,
        xConfig,
        owner,
        {
          accessToken: key,
          accessTokenExpiresAt: null,
          refreshToken: null,
          refreshTokenExpiresAt: null,
          scopes: ['account:read', 'posts:read', 'posts:write']
        },
        { memberId: channelId, name: '@qa', pictureUrl: null },
        { platform: 'x' }
      )
    const xPost = (overrides: Partial<schema.NewPostDraft> = {}) =>
      newPost(x.accountId, {
        platform: 'x',
        formatId: 'x.post',
        hook: 'A short hook',
        body: 'The body (with brackets) #QA',
        firstComment: 'Not sent on X',
        ...overrides
      })
    const rowOf = async (id: string) =>
      (
        await database
          .select()
          .from(schema.publicationsTable)
          .where(eq(schema.publicationsTable.id, id))
      )[0]!

    before(async () => {
      x = await newUser('x', 'google')
    })

    it('X1. without X connected, an X post is refused; LinkedIn alone does not count', async () => {
      await connect(x, 'MEMBER_X')
      const draft = await xPost()
      assert.strictEqual(await codeOf(publishNow(x.userId, draft)), 'not_connected')
      assert.strictEqual(buffer.calls.length + linkedIn.postCalls().length, 0)
    })

    it('X2. connected beside LinkedIn, an X post goes to Buffer as plain text, now', async () => {
      await connectX(x)
      // Both connections, one per platform.
      assert.strictEqual((await getConnection(database, x.accountId))!.memberId, 'MEMBER_X')
      const connection = (await getConnection(database, x.accountId, 'x'))!
      assert.strictEqual(connection.memberId, 'CHANNEL_X')
      assert.ok(connection.accessToken && !connection.accessToken.includes(apiKey), 'key encrypted')

      const draft = await xPost()
      const image: PostImage = {
        bytes: Buffer.from('png'),
        mediaType: 'image/png',
        altText: 'Alt'
      }
      const result = await publishNow(
        x.userId,
        draft,
        deps({ loadImage: async () => image })
      )
      assert.strictEqual(result.status, 'published', String(result.error))
      assert.strictEqual(result.platform, 'x')
      assert.strictEqual(result.externalPostId, 'B1')
      assert.strictEqual(result.metadata.postUrl, 'https://x.com/qa/status/B1')

      const [create] = buffer.creates()
      assert.strictEqual(create!.auth, `Bearer ${apiKey}`)
      const input = create!.variables.input
      assert.strictEqual(input.channelId, 'CHANNEL_X')
      assert.strictEqual(input.mode, 'shareNow')
      // No little-text escaping and no Unicode bold on X.
      assert.strictEqual(input.text, 'A short hook\n\nThe body (with brackets) #QA')
      // The image is a signed link to this post's image only.
      const imageUrl = new URL(input.assets[0].image.url)
      assert.strictEqual(imageUrl.origin, 'https://app.example.com')
      const token = decodeURIComponent(imageUrl.pathname.split('/').pop()!)
      assert.strictEqual(verifyMediaToken(xConfig.encryptionKey, token), draft)
      assert.strictEqual(input.assets[0].image.metadata.altText, 'Alt')
      // No first comment on X, and LinkedIn untouched.
      assert.strictEqual(linkedIn.calls.length, 0)

      const [saved] = await database
        .select()
        .from(schema.postDraftsTable)
        .where(eq(schema.postDraftsTable.id, draft))
      assert.ok(saved!.postedAt, 'marked posted')
    })

    it('X3. a post Buffer is still sending waits, then is confirmed by the worker', async () => {
      const draft = await xPost()
      buffer.answerNextCreates(buffer.pending('P1'))
      const handedOn = await publishNow(x.userId, draft)
      assert.strictEqual(handedOn.status, 'publishing')
      assert.strictEqual(handedOn.externalPostId, 'P1')

      // A second request cannot queue it again meanwhile.
      assert.strictEqual(await codeOf(publishNow(x.userId, draft)), 'already_queued')

      const later = new Date(Date.now() + 60_000)
      buffer.postStatesNext('sending')
      assert.deepStrictEqual(
        await confirmPendingPublications(deps({ now: () => later })),
        { confirmed: 0, failed: 0 }
      )
      const result = await confirmPendingPublications(deps({ now: () => later }))
      assert.strictEqual(result.confirmed, 1)
      const row = await rowOf(handedOn.id)
      assert.strictEqual(row.status, 'published')
      assert.strictEqual(row.metadata.postUrl, 'https://x.com/qa/status/P1')
      // Never sent twice.
      assert.strictEqual(buffer.creates().length, 1)
    })

    it('X4. a post X refused after Buffer took it fails without a retry', async () => {
      const draft = await xPost()
      buffer.answerNextCreates(buffer.pending('P2'))
      const handedOn = await publishNow(x.userId, draft)
      buffer.postStatesNext('error')
      await confirmPendingPublications(deps({ now: () => new Date(Date.now() + 60_000) }))
      const row = await rowOf(handedOn.id)
      assert.strictEqual(row.status, 'failed')
      assert.strictEqual(row.errorCode, 'rejected_by_platform')
      assert.match(row.error ?? '', /Duplicate content/)
    })

    it('X5. a post never confirmed is given up as unknown_outcome', async () => {
      const draft = await xPost()
      buffer.answerNextCreates(buffer.pending('P3'))
      const handedOn = await publishNow(x.userId, draft)
      buffer.postStatesNext('sending')
      await confirmPendingPublications(
        deps({ now: () => new Date(Date.now() + CONFIRM_TIMEOUT_MS + 60_000) })
      )
      const row = await rowOf(handedOn.id)
      assert.strictEqual(row.status, 'failed')
      assert.strictEqual(row.errorCode, 'unknown_outcome')
      // Trying again asks the user to check X first.
      assert.strictEqual(
        await codeOf(publishNow(x.userId, draft)),
        'confirm_unknown_outcome'
      )
    })

    it('X6. Buffer refusing the post, a rate limit and a revoked key', async () => {
      const refused = await xPost()
      buffer.answerNextCreates(() =>
        Response.json({
          data: { createPost: { __typename: 'InvalidInputError', message: 'Text too long' } }
        })
      )
      const r1 = await publishNow(x.userId, refused)
      assert.strictEqual(r1.status, 'failed')
      assert.strictEqual(r1.errorCode, 'rejected_by_platform')

      const limited = await xPost()
      buffer.answerNextCreates(() =>
        Response.json(
          { errors: [{ message: 'Too many', extensions: { code: 'RATE_LIMIT_EXCEEDED' } }] },
          { status: 429 }
        )
      )
      const r2 = await publishNow(x.userId, limited)
      assert.strictEqual(r2.status, 'scheduled', 'retried later')
      assert.strictEqual(r2.errorCode, 'rate_limited')

      const revoked = await xPost()
      buffer.answerNextCreates(() =>
        Response.json({ errors: [{ message: 'Not authorized', extensions: { code: 'UNAUTHORIZED' } }] })
      )
      const r3 = await publishNow(x.userId, revoked)
      assert.strictEqual(r3.status, 'failed')
      assert.strictEqual(r3.errorCode, 'reauth_required')
      assert.strictEqual((await getConnection(database, x.accountId, 'x'))!.status, 'expired')
      // LinkedIn's connection is untouched.
      assert.strictEqual((await getConnection(database, x.accountId))!.status, 'connected')
      await connectX(x)
    })

    it('X7. too long for X, as X counts it, is refused before Buffer is called', async () => {
      const draft = await xPost({ body: `${'word '.repeat(50)}https://example.com/${'a'.repeat(300)}` })
      assert.strictEqual(await codeOf(publishNow(x.userId, draft)), 'too_long')
      // The same length with a long link counted as 23 is fine.
      const ok = await xPost({ body: `Read https://example.com/${'a'.repeat(300)}` })
      assert.strictEqual((await publishNow(x.userId, ok)).status, 'published')
    })

    it('X8. disconnecting X cancels only X posts; X posts cannot be deleted from here', async () => {
      const at = new Date(Date.now() + 3600_000)
      const xDraft = await xPost()
      const liDraft = await newPost(x.accountId)
      const xRow = await requestPublication(database, {
        userId: x.userId, draftId: xDraft, trigger: 'scheduled', scheduledAt: at
      })
      const liRow = await requestPublication(database, {
        userId: x.userId, draftId: liDraft, trigger: 'scheduled', scheduledAt: at
      })
      assert.strictEqual(xRow.platform, 'x')
      assert.strictEqual(liRow.platform, 'linkedin')
      // Every X post waiting (this one, and the one X6 left to retry), no LinkedIn one.
      assert.deepStrictEqual(await disconnect(database, x.accountId, 'x'), { cancelled: 2 })
      assert.strictEqual((await rowOf(xRow.id)).status, 'cancelled')
      assert.strictEqual((await rowOf(liRow.id)).status, 'scheduled')
      await cancelPublication(database, x.userId, liRow.id)

      const [published] = await database
        .select()
        .from(schema.publicationsTable)
        .where(
          and(
            eq(schema.publicationsTable.userId, x.userId),
            eq(schema.publicationsTable.platform, 'x'),
            eq(schema.publicationsTable.status, 'published')
          )
        )
        .limit(1)
      assert.strictEqual(
        await codeOf(deletePublishedPost(deps(), x.userId, published!.id)),
        'not_supported'
      )
    })
  })

  describe('Facebook and Instagram through Buffer', () => {
    let m: { userId: string; accountId: string }
    const connectVia = (platform: 'facebook' | 'instagram', channelId: string) =>
      saveConnection(
        database,
        xConfig,
        m,
        {
          accessToken: 'BUFFER-KEY-META-1234567890',
          accessTokenExpiresAt: null,
          refreshToken: null,
          refreshTokenExpiresAt: null,
          scopes: ['account:read', 'posts:read', 'posts:write']
        },
        { memberId: channelId, name: `${platform} QA`, pictureUrl: null },
        { platform }
      )
    const image: PostImage = {
      bytes: Buffer.from('png'),
      mediaType: 'image/png',
      altText: 'Alt'
    }
    /** An active image on the post, as drafting leaves one. */
    const addImage = (draftId: string) =>
      database.insert(schema.postMediaTable).values({
        draftId,
        mode: 'ai_generated',
        imageUrl: 'https://img.example/a.png'
      })
    const caption = (overrides: Partial<schema.NewPostDraft> = {}) =>
      newPost(m.accountId, {
        platform: 'instagram',
        formatId: 'instagram.caption',
        hook: 'Behind the scenes',
        body: 'Our team at work.',
        cta: '',
        hashtags: ['craft'],
        firstComment: 'Link in bio note',
        ...overrides
      })

    before(async () => {
      m = await newUser('meta', 'google')
    })

    it('M1. a Facebook post goes to its Page, with the first comment in the same Buffer post', async () => {
      await connectVia('facebook', 'CHANNEL_FB')
      const draft = await newPost(m.accountId, {
        platform: 'facebook',
        formatId: 'facebook.post',
        hook: 'Hello neighbours',
        body: 'We are open late on Friday.',
        cta: '',
        hashtags: [],
        firstComment: 'Details: https://example.com/friday'
      })
      const result = await publishNow(
        m.userId,
        draft,
        deps({ loadImage: async () => image })
      )
      assert.strictEqual(result.status, 'published', String(result.error))
      assert.strictEqual(result.platform, 'facebook')

      const [create] = buffer.creates()
      const input = create!.variables.input
      assert.strictEqual(input.channelId, 'CHANNEL_FB')
      assert.strictEqual(input.mode, 'shareNow')
      assert.strictEqual(input.text, 'Hello neighbours\n\nWe are open late on Friday.')
      assert.deepStrictEqual(input.metadata, {
        facebook: { type: 'post', firstComment: 'Details: https://example.com/friday' }
      })
      // A signed link to this post's image, served as Facebook takes it.
      const imageUrl = new URL(input.assets[0].image.url)
      assert.strictEqual(imageUrl.searchParams.get('for'), 'facebook')
      const token = decodeURIComponent(imageUrl.pathname.split('/').pop()!)
      assert.strictEqual(verifyMediaToken(xConfig.encryptionKey, token), draft)
      // No separate comment request, and LinkedIn untouched.
      assert.strictEqual(buffer.creates().length, 1)
      assert.strictEqual(linkedIn.calls.length, 0)
    })

    it('M2. an Instagram caption needs an image; with one it goes out as a feed post', async () => {
      await connectVia('instagram', 'CHANNEL_IG')
      const draft = await caption()
      assert.strictEqual(await codeOf(publishNow(m.userId, draft)), 'needs_image')
      assert.strictEqual(buffer.calls.length, 0)

      await addImage(draft)
      const result = await publishNow(
        m.userId,
        draft,
        deps({ loadImage: async () => image })
      )
      assert.strictEqual(result.status, 'published', String(result.error))
      assert.strictEqual(result.platform, 'instagram')
      const input = buffer.creates()[0]!.variables.input
      assert.strictEqual(input.channelId, 'CHANNEL_IG')
      assert.strictEqual(input.text, 'Behind the scenes\n\nOur team at work.\n\n#craft')
      assert.deepStrictEqual(input.metadata, {
        instagram: { type: 'post', shouldShareToFeed: true }
      })
      assert.strictEqual(
        new URL(input.assets[0].image.url).searchParams.get('for'),
        'instagram'
      )
      // The link-in-bio note is for the author, never posted.
      assert.ok(!JSON.stringify(input).includes('Link in bio note'))
    })

    it('M3. an image removed after queueing fails before Buffer; a Reel cannot be published', async () => {
      const draft = await caption()
      await addImage(draft)
      const result = await publishNow(m.userId, draft, deps({ loadImage: async () => null }))
      assert.strictEqual(result.status, 'failed')
      assert.match(String(result.error), /Instagram posts need an image/)
      assert.strictEqual(buffer.creates().length, 0)

      const reel = await caption({ formatId: 'instagram.reel' })
      await addImage(reel)
      assert.strictEqual(await codeOf(publishNow(m.userId, reel)), 'wrong_platform')
    })

    it('M4. auto-publishing to Instagram skips posts without an image', async () => {
      // 10:00 UTC today; the slot is 09:00 UTC, the posts approved an hour before it.
      const today = new Date()
      today.setUTCHours(10, 0, 0, 0)
      const day = today.toISOString().slice(0, 10)
      const slot = new Date(`${day}T09:00:00Z`)
      const before = new Date(slot.getTime() - 3600_000)
      const withImage = await caption({ plannedFor: day, updatedAt: before })
      await addImage(withImage)
      const without = await caption({ plannedFor: day, updatedAt: before })
      await database
        .update(schema.platformConnectionsTable)
        .set({
          autoPublish: true,
          autoPublishTime: '09:00',
          autoPublishTimezone: 'UTC',
          autoPublishEnabledAt: new Date(slot.getTime() - 24 * 3600_000)
        })
        .where(
          and(
            eq(schema.platformConnectionsTable.userId, m.userId),
            eq(schema.platformConnectionsTable.platform, 'instagram')
          )
        )
      await queueAutoPublications(database, today)
      const queued = await database
        .select({ draftId: schema.publicationsTable.draftId })
        .from(schema.publicationsTable)
        .where(inArray(schema.publicationsTable.draftId, [withImage, without]))
      assert.deepStrictEqual(queued.map(r => r.draftId), [withImage])
    })

    it('M6. an Instagram carousel goes out as one post with every slide, each from its own signed link', async () => {
      await connectVia('instagram', 'CHANNEL_IG')
      const draft = await caption({ mediaFormat: 'carousel' })
      await addSlides(draft, 3)
      const result = await publishNow(m.userId, draft)
      assert.strictEqual(result.status, 'published', String(result.error))

      const [create] = buffer.creates()
      const assets = create!.variables.input.assets as Array<{ image: { url: string; metadata?: { altText: string } } }>
      assert.strictEqual(assets.length, 3)
      const slideIds = (
        await database
          .select({ id: schema.postSlidesTable.id })
          .from(schema.postSlidesTable)
          .where(eq(schema.postSlidesTable.draftId, draft))
          .orderBy(schema.postSlidesTable.position)
      ).map(r => r.id)
      assets.forEach((asset, i) => {
        const link = new URL(asset.image.url)
        assert.strictEqual(link.searchParams.get('for'), 'instagram')
        const token = decodeURIComponent(link.pathname.split('/').pop()!)
        // Signed for this post's slide, in swipe order, and no other.
        const subject = verifyMediaToken(xConfig.encryptionKey, token)
        assert.deepStrictEqual(parseMediaSubject(subject!), { draftId: draft, slideId: slideIds[i] })
        assert.strictEqual(asset.image.metadata?.altText, `Slide ${i + 1} described`)
      })
    })

    it('M7. auto-publishing to Instagram takes a carousel, which has no single image', async () => {
      const day = new Date().toISOString().slice(0, 10)
      const slot = new Date(`${day}T09:00:00Z`)
      const before = new Date(slot.getTime() - 3600_000)
      const carousel = await caption({ mediaFormat: 'carousel', plannedFor: day, updatedAt: before })
      await addSlides(carousel, 3)
      await database
        .update(schema.platformConnectionsTable)
        .set({
          autoPublish: true,
          autoPublishTime: '09:00',
          autoPublishTimezone: 'UTC',
          // Not M4's: the engine remembers each slot it queued, by this time.
          autoPublishEnabledAt: new Date(slot.getTime() - 25 * 3600_000)
        })
        .where(
          and(
            eq(schema.platformConnectionsTable.userId, m.userId),
            eq(schema.platformConnectionsTable.platform, 'instagram')
          )
        )
      await queueAutoPublications(database, new Date(slot.getTime() + 3600_000))
      const queued = await database
        .select({ draftId: schema.publicationsTable.draftId })
        .from(schema.publicationsTable)
        .where(eq(schema.publicationsTable.draftId, carousel))
      assert.deepStrictEqual(queued.map(r => r.draftId), [carousel])
    })

    it('M5. each network keeps its own connection: disconnecting Instagram leaves Facebook alone', async () => {
      assert.ok(await disconnect(database, m.accountId, 'instagram'))
      assert.strictEqual((await getConnection(database, m.accountId, 'instagram'))!.status, 'disconnected')
      assert.strictEqual((await getConnection(database, m.accountId, 'facebook'))!.status, 'connected')
    })
  })
})
