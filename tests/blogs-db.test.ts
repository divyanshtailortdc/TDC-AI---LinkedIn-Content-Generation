import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import { EMPTY_USAGE } from '../src/lib/ai/usage'
import {
  claimBlogGeneration,
  createClaimedBlog,
  failBlogGeneration,
  saveGeneratedBlog,
  type GeneratedBlog
} from '../src/lib/blogs/claim'
import { slugify } from '../src/lib/blogs/doc'
import type { BlogEdit } from '../src/lib/blogs/input'
import { listBlogRevisions } from '../src/lib/blogs/revisions'
import {
  applySectionRewrite,
  deleteIdentityBlog,
  findIdentityBlog,
  restoreBlogRevision,
  saveBlogEdit,
  setBlogPublished,
  setBlogVerification,
  setFeaturedImage
} from '../src/lib/blogs/store'
import type { BlogBrief, BlogPlan, FeaturedImage } from '../src/lib/blogs/types'
import { findOwnedBlog } from '../src/lib/ownership'

// Runs against the local development database; every row it makes is removed.
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]
const handle = `qa-blog-${Date.now().toString(36)}`

const BRIEF: BlogBrief = {
  topic: 'Cart abandonment',
  primaryKeyword: 'cart abandonment',
  secondaryKeywords: [],
  length: 'medium',
  style: 'how_to',
  audience: { audienceId: null, note: '' },
  research: true,
  knowledge: true,
  faq: true,
  instructions: '',
  caseDetails: ''
}

describe('blog tables', { skip: !url }, () => {
  const client = postgres(url!, { max: 4, prepare: false })
  const database = drizzle(client, { schema })
  let accountId = ''

  before(async () => {
    await client`delete from accounts where handle like 'qa-blog-%'`
    const [account] = await database
      .insert(schema.accountsTable)
      .values({
        name: 'QA Blogs',
        accountType: 'company',
        handle,
        headline: 'QA'
      })
      .returning()
    accountId = account!.id
  })
  after(async () => {
    await client`delete from accounts where handle like 'qa-blog-%'`
    await client.end()
  })

  it('accepts AI spend under the blogs source', async () => {
    // Rolled back, never committed: tests/ai-spend.test.ts re-adds older
    // source constraints in its own transactions.
    const ROLLBACK = new Error('rolled back on purpose')
    await database
      .transaction(async tx => {
        const [row] = await tx
          .insert(schema.aiUsageTable)
          .values({
            accountId,
            source: 'blogs',
            stage: 'blog_drafting',
            model: 'test'
          })
          .returning()
        assert.strictEqual(row!.source, 'blogs')
        throw ROLLBACK
      })
      .catch(err => {
        if (err !== ROLLBACK) throw err
      })
  })

  it('starts a new blog generating, as a draft, with an empty document', async () => {
    const [blog] = await database
      .insert(schema.blogsTable)
      .values({ accountId, brief: BRIEF })
      .returning()
    assert.strictEqual(blog!.generationStatus, 'generating')
    assert.strictEqual(blog!.status, 'draft')
    assert.strictEqual(blog!.kind, 'blog')
    assert.deepStrictEqual(blog!.content, { type: 'doc', content: [] })
    assert.deepStrictEqual(blog!.faq, [])
    assert.strictEqual(blog!.lockVersion, 1)
    assert.strictEqual(blog!.wordCount, 0)
  })

  it('refuses an unknown kind', async () => {
    await assert.rejects(
      database
        .insert(schema.blogsTable)
        .values({ accountId, brief: BRIEF, kind: 'video' as 'blog' })
    )
  })

  it('keeps numbered versions of a blog, removed with it', async () => {
    const [blog] = await database
      .insert(schema.blogsTable)
      .values({ accountId, brief: BRIEF })
      .returning()
    await database.insert(schema.blogRevisionsTable).values({
      blogId: blog!.id,
      number: 1,
      replacedBy: 'user_edit',
      snapshot: {
        title: 'T',
        slug: 't',
        metaTitle: '',
        metaDescription: '',
        primaryKeyword: '',
        keywords: [],
        content: { type: 'doc', content: [] },
        faq: [],
        wordCount: 0
      }
    })
    await assert.rejects(
      database.insert(schema.blogRevisionsTable).values({
        blogId: blog!.id,
        number: 1,
        replacedBy: 'user_edit',
        snapshot: {
          title: 'T2',
          slug: 't',
          metaTitle: '',
          metaDescription: '',
          primaryKeyword: '',
          keywords: [],
          content: { type: 'doc', content: [] },
          faq: [],
          wordCount: 0
        }
      })
    )
    await database
      .delete(schema.blogsTable)
      .where(eq(schema.blogsTable.id, blog!.id))
    const left = await database
      .select()
      .from(schema.blogRevisionsTable)
      .where(eq(schema.blogRevisionsTable.blogId, blog!.id))
    assert.deepStrictEqual(left, [])
  })
})

const docOf = (text: string) => ({
  type: 'doc' as const,
  content: [
    { type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }
  ]
})

const generated = (title: string): GeneratedBlog => ({
  title,
  slug: slugify(title),
  metaTitle: `${title} meta`,
  metaDescription: 'Description',
  primaryKeyword: 'cart abandonment',
  keywords: [],
  content: docOf(`${title} body words`),
  faq: [],
  sources: [],
  wordCount: 3,
  checks: [],
  selfFlags: [],
  usage: { ...EMPTY_USAGE, calls: 1, costUsd: 0.05 },
  model: 'test-model',
  searchIntent: 'informational',
  plan: null,
  featuredImage: null,
  verification: null,
  internalLinks: []
})

const editOf = (title: string): BlogEdit => ({
  title,
  slug: slugify(title),
  metaTitle: `${title} meta`,
  metaDescription: 'Description',
  primaryKeyword: 'cart abandonment',
  keywords: [],
  searchIntent: '',
  content: docOf(`${title} edited`),
  faq: [],
  featuredAlt: '',
  featuredCaption: ''
})

const IMAGE = (alt: string): FeaturedImage => ({
  status: 'ready',
  src: 'data:image/webp;base64,AAAA',
  alt,
  caption: '',
  width: 1600,
  height: 900,
  mediaType: 'image/webp',
  model: 'test-image',
  prompt: 'a cart in an aisle',
  createdAt: '2026-11-25T10:00:00.000Z'
})

const PLAN: BlogPlan = {
  searchIntent: 'commercial',
  primaryKeyword: 'cart abandonment',
  secondaryKeywords: [],
  readerNeed: 'Which fix first?',
  angle: 'Fees first.',
  originality: 'A ranking.',
  workingTitle: 'Fixes',
  sections: [],
  takeaways: false,
  faq: [],
  product: { role: 'none', where: '', note: '' },
  cta: { kind: 'none', text: '', url: null },
  featuredImage: { concept: 'a cart', alt: 'a cart', style: 'photo' },
  internalLinks: [],
  gaps: [],
  cautions: []
}

const MINUTE = 60_000

describe('blog claims, saves and versions', { skip: !url }, () => {
  const client = postgres(url!, { max: 8, prepare: false })
  const database = drizzle(client, { schema })
  const tag = `qa-blogc-${Date.now().toString(36)}`
  let userA = ''
  let userB = ''
  let accountA = ''
  let accountB = ''

  const makeUser = async (suffix: string) => {
    const [row] = await database
      .insert(schema.authUsersTable)
      .values({ name: `QA ${suffix}`, email: `${tag}-${suffix}@example.test` })
      .returning()
    return row!.id
  }
  const makeAccount = async (userId: string, name: string, suffix: string) => {
    const [row] = await database
      .insert(schema.accountsTable)
      .values({ userId, name, handle: `${tag}-${suffix}`, headline: 'QA' })
      .returning()
    return row!.id
  }

  /** A blog of identity A, claimed and generating. */
  const claimed = (now?: Date, accountId = accountA, id = randomUUID()) =>
    createClaimedBlog(
      database,
      { id, accountId, ideaId: null, goalId: null, kind: 'blog', brief: BRIEF },
      now
    )
  /** A blog of identity A whose first generation saved `title`. */
  const ready = async (title: string) => {
    const created = await claimed()
    assert.strictEqual(created.outcome, 'created')
    if (created.outcome !== 'created') throw new Error('not created')
    assert.strictEqual(
      await saveGeneratedBlog(database, created.claim, generated(title), {
        keepRevision: true,
        instruction: null
      }),
      true
    )
    return created.claim.blogId
  }
  const current = async (blogId: string) =>
    (await findIdentityBlog(database, accountA, blogId))!

  before(async () => {
    await client`delete from accounts where handle like 'qa-blogc-%'`
    await client`delete from auth_users where email like 'qa-blogc-%'`
    userA = await makeUser('a')
    userB = await makeUser('b')
    accountA = await makeAccount(userA, 'QA Blog A', 'a')
    accountB = await makeAccount(userB, 'QA Blog B', 'b')
  })
  after(async () => {
    await client`delete from accounts where handle like 'qa-blogc-%'`
    await client`delete from auth_users where email like 'qa-blogc-%'`
    await client.end()
  })

  it('starts one generation however many regenerations race', async () => {
    const blogId = await ready('One')
    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        claimBlogGeneration(database, { accountId: accountA, blogId })
      )
    )
    assert.strictEqual(claims.filter(Boolean).length, 1)
  })

  it('takes over a claim that went stale', async () => {
    const start = new Date('2026-11-24T10:00:00Z')
    const created = await claimed(start)
    assert.strictEqual(created.outcome, 'created')
    if (created.outcome !== 'created') return
    const ref = { accountId: accountA, blogId: created.claim.blogId }
    assert.strictEqual(
      await claimBlogGeneration(
        database,
        ref,
        new Date(start.getTime() + 479_000)
      ),
      null
    )
    assert.ok(
      await claimBlogGeneration(
        database,
        ref,
        new Date(start.getTime() + 481_000)
      )
    )
  })

  it('saves a result only under the claim that started it', async () => {
    const created = await claimed(new Date(Date.now() - 10 * MINUTE))
    if (created.outcome !== 'created') throw new Error('not created')
    const first = created.claim
    const second = await claimBlogGeneration(database, {
      accountId: accountA,
      blogId: first.blogId
    })
    assert.ok(second)
    const options = { keepRevision: true, instruction: null }
    assert.strictEqual(
      await saveGeneratedBlog(database, first, generated('First'), options),
      false
    )
    assert.strictEqual(
      await saveGeneratedBlog(database, second!, generated('Second'), options),
      true
    )
    const row = await current(first.blogId)
    assert.strictEqual(row.title, 'Second')
    assert.strictEqual(row.generationStatus, 'ready')
    assert.strictEqual(row.generationStage, null)
  })

  it('keeps the replaced version when regenerating, and none for the first', async () => {
    const blogId = await ready('One')
    assert.deepStrictEqual(await listBlogRevisions(database, blogId), [])
    const claim = await claimBlogGeneration(database, {
      accountId: accountA,
      blogId
    })
    assert.ok(
      await saveGeneratedBlog(database, claim!, generated('Two'), {
        keepRevision: true,
        instruction: 'shorter'
      })
    )
    const versions = await listBlogRevisions(database, blogId)
    assert.deepStrictEqual(
      versions.map(v => [
        v.number,
        v.replacedBy,
        v.instruction,
        v.snapshot.title
      ]),
      [[1, 'regenerate', 'shorter', 'One']]
    )
    const row = await current(blogId)
    assert.strictEqual(row.title, 'Two')
    assert.strictEqual(row.usage.costUsd, 0.1)
  })

  it('records a failure with what it cost', async () => {
    const created = await claimed()
    if (created.outcome !== 'created') throw new Error('not created')
    assert.strictEqual(
      await failBlogGeneration(
        database,
        created.claim,
        'Spending limit reached.',
        {
          ...EMPTY_USAGE,
          calls: 1,
          costUsd: 0.02
        }
      ),
      true
    )
    const row = await current(created.claim.blogId)
    assert.strictEqual(row.generationStatus, 'failed')
    assert.strictEqual(row.generationError, 'Spending limit reached.')
    assert.strictEqual(row.usage.costUsd, 0.02)
  })

  it('creates one blog for a repeated request id', async () => {
    const id = randomUUID()
    const first = await claimed(undefined, accountA, id)
    assert.strictEqual(first.outcome, 'created')
    assert.deepStrictEqual(await claimed(undefined, accountA, id), {
      outcome: 'exists',
      blogId: id
    })
    assert.deepStrictEqual(await claimed(undefined, accountB, id), {
      outcome: 'taken'
    })
  })

  it('refuses a save from an old lock version', async () => {
    const blogId = await ready('One')
    const row = await current(blogId)
    assert.deepStrictEqual(
      await saveBlogEdit(database, {
        accountId: accountA,
        blogId,
        lockVersion: row.lockVersion - 1,
        edit: editOf('Changed'),
        wordCount: 2,
        checks: []
      }),
      { ok: false, reason: 'conflict' }
    )
    assert.strictEqual((await current(blogId)).title, 'One')
  })

  it('refuses saves while generating', async () => {
    const blogId = await ready('One')
    const { lockVersion } = await current(blogId)
    await claimBlogGeneration(database, { accountId: accountA, blogId })
    assert.deepStrictEqual(
      await saveBlogEdit(database, {
        accountId: accountA,
        blogId,
        lockVersion,
        edit: editOf('Changed'),
        wordCount: 2,
        checks: []
      }),
      { ok: false, reason: 'generating' }
    )
  })

  it('saves over a regeneration that went stale, which then cannot overwrite it', async () => {
    const blogId = await ready('One')
    const { lockVersion } = await current(blogId)
    const stale = await claimBlogGeneration(
      database,
      { accountId: accountA, blogId },
      new Date(Date.now() - 10 * MINUTE)
    )
    assert.ok(stale)
    const saved = await saveBlogEdit(database, {
      accountId: accountA,
      blogId,
      lockVersion,
      edit: editOf('Mine'),
      wordCount: 2,
      checks: []
    })
    assert.strictEqual(saved.ok, true)
    assert.strictEqual((await current(blogId)).generationStatus, 'ready')
    assert.strictEqual(
      await saveGeneratedBlog(database, stale!, generated('Late'), {
        keepRevision: true,
        instruction: null
      }),
      false
    )
    assert.strictEqual((await current(blogId)).title, 'Mine')
  })

  it('keeps one version for manual saves within 10 minutes', async () => {
    const blogId = await ready('One')
    const t0 = new Date()
    const save = async (title: string, at: Date) => {
      const result = await saveBlogEdit(database, {
        accountId: accountA,
        blogId,
        lockVersion: (await current(blogId)).lockVersion,
        edit: editOf(title),
        wordCount: 2,
        checks: [],
        now: at
      })
      assert.strictEqual(result.ok, true)
    }
    await save('Two', t0)
    await save('Three', new Date(t0.getTime() + MINUTE))
    assert.deepStrictEqual(
      (await listBlogRevisions(database, blogId)).map(v => v.snapshot.title),
      ['One']
    )
    await save('Four', new Date(t0.getTime() + 11 * MINUTE))
    assert.deepStrictEqual(
      (await listBlogRevisions(database, blogId)).map(v => v.snapshot.title),
      ['Three', 'One']
    )
    assert.strictEqual((await current(blogId)).title, 'Four')
  })

  it('restores a version and keeps the text it replaced', async () => {
    const blogId = await ready('One')
    const saved = await saveBlogEdit(database, {
      accountId: accountA,
      blogId,
      lockVersion: (await current(blogId)).lockVersion,
      edit: editOf('Two'),
      wordCount: 2,
      checks: []
    })
    assert.strictEqual(saved.ok, true)
    const [first] = await listBlogRevisions(database, blogId)
    const restored = await restoreBlogRevision(database, {
      accountId: accountA,
      blogId,
      revisionId: first!.id,
      checksFor: snapshot => [
        {
          rule: 'seen',
          severity: 'info',
          message: snapshot.title,
          passed: true
        }
      ]
    })
    assert.strictEqual(restored.ok, true)
    const row = await current(blogId)
    assert.strictEqual(row.title, 'One')
    assert.deepStrictEqual(row.checks, [
      { rule: 'seen', severity: 'info', message: 'One', passed: true }
    ])
    const [newest] = await listBlogRevisions(database, blogId)
    assert.strictEqual(newest!.replacedBy, 'restore')
    assert.strictEqual(newest!.snapshot.title, 'Two')
    assert.deepStrictEqual(
      await restoreBlogRevision(database, {
        accountId: accountA,
        blogId,
        revisionId: randomUUID(),
        checksFor: () => []
      }),
      { ok: false, reason: 'version_not_found' }
    )
  })

  it('applies a section rewrite as a new version and adds its cost', async () => {
    const blogId = await ready('One')
    const before = await current(blogId)
    const result = await applySectionRewrite(database, {
      accountId: accountA,
      blogId,
      lockVersion: before.lockVersion,
      content: docOf('Rewritten'),
      sources: [],
      wordCount: 1,
      checks: [],
      usage: { ...EMPTY_USAGE, calls: 1, costUsd: 0.01 },
      instruction: 'Add an example'
    })
    assert.strictEqual(result.ok, true)
    const row = await current(blogId)
    assert.deepStrictEqual(row.content, docOf('Rewritten'))
    assert.ok(
      Math.abs(row.usage.costUsd! - 0.06) < 1e-9,
      String(row.usage.costUsd)
    )
    const [newest] = await listBlogRevisions(database, blogId)
    assert.deepStrictEqual(
      [newest!.replacedBy, newest!.instruction],
      ['section_rewrite', 'Add an example']
    )
  })

  it('marks a blog published and back to a draft', async () => {
    const blogId = await ready('One')
    const published = await setBlogPublished(database, {
      accountId: accountA,
      blogId,
      published: true,
      url: 'https://example.com/blog/one'
    })
    assert.strictEqual(published.ok, true)
    let row = await current(blogId)
    assert.strictEqual(row.status, 'published')
    assert.strictEqual(row.publishedUrl, 'https://example.com/blog/one')
    assert.ok(row.publishedAt)
    await setBlogPublished(database, {
      accountId: accountA,
      blogId,
      published: false,
      url: null
    })
    row = await current(blogId)
    assert.strictEqual(row.status, 'draft')
    assert.strictEqual(row.publishedAt, null)
    assert.strictEqual(row.publishedTo, null)
  })

  it('records where and when a blog was published', async () => {
    const blogId = await ready('Where')
    const on = new Date('2026-11-20T06:30:00.000Z')
    await setBlogPublished(database, {
      accountId: accountA,
      blogId,
      published: true,
      url: 'https://shop.example/blogs/news/where',
      destination: 'wordpress',
      publishedAt: on
    })
    let row = await current(blogId)
    assert.strictEqual(row.publishedTo, 'wordpress')
    assert.strictEqual(row.publishedAt?.toISOString(), on.toISOString())

    // Said neither where nor when: the identity's website, now.
    await setBlogPublished(database, {
      accountId: accountA,
      blogId,
      published: true,
      url: null
    })
    row = await current(blogId)
    assert.strictEqual(row.publishedTo, 'website')
    assert.ok(Math.abs(row.publishedAt!.getTime() - Date.now()) < 5000)

    await setBlogPublished(database, {
      accountId: accountA,
      blogId,
      published: false,
      url: null
    })
    row = await current(blogId)
    assert.strictEqual(row.publishedTo, null)
    assert.strictEqual(row.publishedUrl, null)
    assert.strictEqual(row.publishedAt, null)
  })

  it('saves a generation with its plan, verification, intent and internal links', async () => {
    const created = await claimed()
    assert.strictEqual(created.outcome, 'created')
    if (created.outcome !== 'created') return
    const verification = {
      checkedAt: '2026-11-25T10:00:00.000Z',
      citations: [{ sourceId: 'S1', sentence: 'A.', verdict: 'supported' as const, reason: '' }],
      issues: [],
      removedLinks: []
    }
    await saveGeneratedBlog(
      database,
      created.claim,
      {
        ...generated('Planned'),
        searchIntent: 'commercial',
        plan: PLAN,
        featuredImage: IMAGE('A cart left in an aisle'),
        verification,
        internalLinks: [
          { url: 'https://n.test/kit', title: 'Kit', anchor: 'our kit', reason: '', placed: true }
        ]
      },
      { keepRevision: true, instruction: null }
    )
    const row = await current(created.claim.blogId)
    assert.strictEqual(row.searchIntent, 'commercial')
    assert.deepStrictEqual(row.plan, PLAN)
    assert.strictEqual(row.featuredImage?.alt, 'A cart left in an aisle')
    assert.deepStrictEqual(row.verification, verification)
    assert.strictEqual(row.internalLinks[0]?.anchor, 'our kit')
  })

  it('keeps the featured image when a regeneration says keep', async () => {
    const blogId = await ready('One')
    const image = await setFeaturedImage(database, {
      accountId: accountA,
      blogId,
      image: IMAGE('First image')
    })
    assert.strictEqual(image.ok, true)
    const claim = await claimBlogGeneration(database, { accountId: accountA, blogId })
    assert.ok(claim)
    await saveGeneratedBlog(
      database,
      claim!,
      { ...generated('Two'), featuredImage: 'keep' },
      { keepRevision: true, instruction: null }
    )
    assert.strictEqual((await current(blogId)).featuredImage?.alt, 'First image')
  })

  it('saves the search intent and the image text with an edit', async () => {
    const blogId = await ready('One')
    await setFeaturedImage(database, { accountId: accountA, blogId, image: IMAGE('Old alt') })
    const saved = await saveBlogEdit(database, {
      accountId: accountA,
      blogId,
      lockVersion: (await current(blogId)).lockVersion,
      edit: { ...editOf('Two'), searchIntent: 'transactional', featuredAlt: 'New alt', featuredCaption: 'A caption' },
      wordCount: 2,
      checks: []
    })
    assert.strictEqual(saved.ok, true)
    const row = await current(blogId)
    assert.strictEqual(row.searchIntent, 'transactional')
    assert.strictEqual(row.featuredImage?.status, 'ready')
    if (row.featuredImage?.status !== 'ready') return
    assert.strictEqual(row.featuredImage.alt, 'New alt')
    assert.strictEqual(row.featuredImage.caption, 'A caption')
  })

  it('replaces and removes a featured image, keeping each earlier one as a version', async () => {
    const blogId = await ready('One')
    await setFeaturedImage(database, { accountId: accountA, blogId, image: IMAGE('First') })
    await setFeaturedImage(database, {
      accountId: accountA,
      blogId,
      image: IMAGE('Second'),
      usage: { ...EMPTY_USAGE, calls: 1, costUsd: 0.08 }
    })
    const row = await current(blogId)
    assert.strictEqual(row.featuredImage?.alt, 'Second')
    assert.ok((row.usage.costUsd ?? 0) >= 0.13 - 1e-9, String(row.usage.costUsd))
    const [newest] = await listBlogRevisions(database, blogId)
    assert.strictEqual(newest!.replacedBy, 'image')
    assert.strictEqual(newest!.snapshot.featuredImage?.alt, 'First')
    const removed = await setFeaturedImage(database, { accountId: accountA, blogId, image: null })
    assert.strictEqual(removed.ok, true)
    assert.strictEqual((await current(blogId)).featuredImage, null)
  })

  it('brings the featured image back with a restored version', async () => {
    const blogId = await ready('One')
    await setFeaturedImage(database, { accountId: accountA, blogId, image: IMAGE('Kept') })
    await setFeaturedImage(database, { accountId: accountA, blogId, image: null })
    const [newest] = await listBlogRevisions(database, blogId)
    const restored = await restoreBlogRevision(database, {
      accountId: accountA,
      blogId,
      revisionId: newest!.id,
      checksFor: () => []
    })
    assert.strictEqual(restored.ok, true)
    assert.strictEqual((await current(blogId)).featuredImage?.alt, 'Kept')
  })

  it('records a check of the sources without a new version', async () => {
    const blogId = await ready('One')
    const before = await current(blogId)
    const verification = {
      checkedAt: '2026-11-25T11:00:00.000Z',
      citations: [],
      issues: [{ sentence: 'X.', issue: 'fact_without_source' as const, note: 'n' }],
      removedLinks: []
    }
    const result = await setBlogVerification(database, {
      accountId: accountA,
      blogId,
      lockVersion: before.lockVersion,
      verification,
      checks: [],
      usage: { ...EMPTY_USAGE, calls: 1, costUsd: 0.02 }
    })
    assert.strictEqual(result.ok, true)
    const row = await current(blogId)
    assert.deepStrictEqual(row.verification, verification)
    assert.strictEqual(row.lockVersion, before.lockVersion)
    assert.strictEqual((await listBlogRevisions(database, blogId)).length, 0)
  })

  it("does not mark another identity's blog published", async () => {
    const blogId = await ready('Theirs')
    const outcome = await setBlogPublished(database, {
      accountId: randomUUID(),
      blogId,
      published: true,
      url: null,
      destination: 'shopify',
      publishedAt: null
    })
    assert.deepStrictEqual(outcome, { ok: false, reason: 'not_found' })
    assert.strictEqual((await current(blogId)).publishedTo, null)
  })

  it("hides another user's blog", async () => {
    const blogId = await ready('Mine')
    assert.strictEqual(await findOwnedBlog(database, userB, blogId), undefined)
    assert.deepStrictEqual(await findOwnedBlog(database, userA, blogId), {
      id: blogId,
      accountId: accountA,
      accountName: 'QA Blog A'
    })
    assert.strictEqual(
      await findOwnedBlog(database, userA, 'not-a-uuid'),
      undefined
    )
    assert.deepStrictEqual(
      await saveBlogEdit(database, {
        accountId: accountB,
        blogId,
        lockVersion: (await current(blogId)).lockVersion,
        edit: editOf('Theirs'),
        wordCount: 1,
        checks: []
      }),
      { ok: false, reason: 'not_found' }
    )
    assert.strictEqual(
      await claimBlogGeneration(database, { accountId: accountB, blogId }),
      null
    )
    assert.strictEqual(
      await deleteIdentityBlog(database, accountB, blogId),
      false
    )
    assert.ok(await findIdentityBlog(database, accountA, blogId))
    assert.strictEqual(
      await findIdentityBlog(database, accountB, blogId),
      undefined
    )
    assert.strictEqual(
      await deleteIdentityBlog(database, accountA, blogId),
      true
    )
    assert.strictEqual(
      await findIdentityBlog(database, accountA, blogId),
      undefined
    )
  })
})
