import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import postgres from 'postgres'
import { loadPublishedContent } from '../src/app/(app)/published/published-data'
import * as schema from '../src/db/schema'
import type { BlogBrief } from '../src/lib/blogs/types'
import type { PublishedFilters } from '../src/lib/published-content'

// Runs against the local development database; every row it makes is removed.
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]

const BRIEF: BlogBrief = {
  topic: 'Checkout fees',
  primaryKeyword: 'checkout fees',
  secondaryKeywords: [],
  length: 'medium',
  style: 'how_to',
  audience: { audienceId: null, note: '' },
  research: false,
  knowledge: false,
  faq: false,
  instructions: '',
  caseDetails: ''
}

const HOUR = 3_600_000
const ALL: PublishedFilters = { type: null, destination: null }

describe('published content', { skip: !url }, () => {
  const client = postgres(url!, { max: 4, prepare: false })
  const database = drizzle(client, { schema })
  const tag = `qa-pub-${Date.now().toString(36)}`
  const now = Date.now()
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR)
  const ids: Record<string, string> = {}

  const makeAccount = async (suffix: string) => {
    const [user] = await database
      .insert(schema.authUsersTable)
      .values({ name: `QA ${suffix}`, email: `${tag}-${suffix}@example.test` })
      .returning()
    const [account] = await database
      .insert(schema.accountsTable)
      .values({
        userId: user!.id,
        name: `QA Pub ${suffix}`,
        handle: `${tag}-${suffix}`,
        headline: 'QA'
      })
      .returning()
    return account!.id
  }
  const post = async (
    accountId: string,
    values: Partial<typeof schema.postDraftsTable.$inferInsert> & {
      hook: string
    }
  ) => {
    const [row] = await database
      .insert(schema.postDraftsTable)
      .values({
        accountId,
        body: `${values.hook} body`,
        originalHook: values.hook,
        originalBody: `${values.hook} body`,
        ...values
      })
      .returning()
    return row!.id
  }
  const blog = async (
    accountId: string,
    values: Partial<typeof schema.blogsTable.$inferInsert> & { title: string }
  ) => {
    const [row] = await database
      .insert(schema.blogsTable)
      .values({
        accountId,
        brief: BRIEF,
        generationStatus: 'ready',
        ...values
      })
      .returning()
    return row!.id
  }
  const keysOf = (items: { type: string; id: string }[]) =>
    items.map(item => `${item.type}:${item.id}`)

  let accountA = ''
  let accountB = ''

  before(async () => {
    await client`delete from accounts where handle like 'qa-pub-%'`
    await client`delete from auth_users where email like 'qa-pub-%'`
    accountA = await makeAccount('a')
    accountB = await makeAccount('b')

    ids.linkedin = await post(accountA, {
      hook: 'Out on LinkedIn',
      platform: 'linkedin',
      formatId: 'linkedin.post',
      status: 'approved',
      postedAt: at(1)
    })
    // Hidden from the Posts queue, but still out on Instagram.
    ids.instagram = await post(accountA, {
      hook: 'Out on Instagram',
      platform: 'instagram',
      formatId: 'instagram.caption',
      status: 'approved',
      postedAt: at(3),
      hiddenAt: at(2)
    })
    // Approved, not out yet; and one deleted from its platform since.
    ids.approved = await post(accountA, {
      hook: 'Waiting',
      platform: 'x',
      formatId: 'x.post',
      status: 'approved'
    })
    // A format the app no longer has.
    ids.tiktok = await post(accountA, {
      hook: 'Old TikTok',
      platform: 'linkedin',
      formatId: 'tiktok.video',
      status: 'approved',
      postedAt: at(2)
    })
    ids.wordpress = await blog(accountA, {
      title: 'On WordPress',
      kind: 'article',
      status: 'published',
      publishedTo: 'wordpress',
      publishedUrl: 'https://brightcart.example/on-wordpress/',
      publishedAt: at(2.5)
    })
    // Marked published before the app asked where.
    ids.unrecorded = await blog(accountA, {
      title: 'Somewhere',
      status: 'published',
      publishedAt: at(4)
    })
    ids.draft = await blog(accountA, { title: 'Still a draft' })

    ids.otherPost = await post(accountB, {
      hook: 'Another identity',
      platform: 'linkedin',
      formatId: 'linkedin.post',
      status: 'approved',
      postedAt: at(0.5)
    })
    ids.otherBlog = await blog(accountB, {
      title: 'Another identity',
      status: 'published',
      publishedTo: 'shopify',
      publishedAt: at(0.2)
    })
  })
  after(async () => {
    await client`delete from accounts where handle like 'qa-pub-%'`
    await client`delete from auth_users where email like 'qa-pub-%'`
    await client.end()
  })

  it('lists what is out, of both content types, newest first', async () => {
    const { items, counts, pageInfo } = await loadPublishedContent(
      database,
      accountA,
      ALL,
      1
    )
    assert.deepStrictEqual(keysOf(items), [
      `social:${ids.linkedin}`,
      `blog:${ids.wordpress}`,
      `social:${ids.instagram}`,
      `blog:${ids.unrecorded}`
    ])
    assert.deepStrictEqual(
      { all: counts.all, social: counts.social, blog: counts.blog },
      { all: 4, social: 2, blog: 2 }
    )
    assert.deepStrictEqual(counts.byDestination, {
      linkedin: 1,
      instagram: 1,
      wordpress: 1,
      unrecorded: 1
    })
    assert.strictEqual(pageInfo.total, 4)
  })

  it('describes each item for the list', async () => {
    const { items } = await loadPublishedContent(database, accountA, ALL, 1)
    const [linkedin, wordpress, , unrecorded] = items
    assert.deepStrictEqual(
      {
        destination: linkedin!.destination,
        title: linkedin!.title,
        detail: linkedin!.detail,
        href: linkedin!.href,
        liveUrl: linkedin!.liveUrl,
        publishedAt: linkedin!.publishedAt
      },
      {
        destination: 'linkedin',
        title: 'Out on LinkedIn',
        detail: 'LinkedIn post',
        href: `/posts/${ids.linkedin}`,
        liveUrl: null,
        publishedAt: at(1).toISOString()
      }
    )
    assert.deepStrictEqual(
      {
        destination: wordpress!.destination,
        title: wordpress!.title,
        detail: wordpress!.detail,
        href: wordpress!.href,
        liveUrl: wordpress!.liveUrl
      },
      {
        destination: 'wordpress',
        title: 'On WordPress',
        detail: 'Article',
        href: `/blogs/${ids.wordpress}`,
        liveUrl: 'https://brightcart.example/on-wordpress/'
      }
    )
    assert.strictEqual(unrecorded!.destination, 'unrecorded')
  })

  it('gives a post the live page its publication links to', async () => {
    const { items } = await loadPublishedContent(database, accountA, ALL, 1, {
      liveUrls: async postIds =>
        new Map(
          postIds
            .filter(id => id === ids.linkedin)
            .map(id => [id, 'https://www.linkedin.com/feed/update/1'])
        )
    })
    assert.strictEqual(
      items[0]!.liveUrl,
      'https://www.linkedin.com/feed/update/1'
    )
    assert.strictEqual(items[2]!.liveUrl, null)
  })

  it('narrows to one content type, counting that type’s destinations', async () => {
    const { items, counts } = await loadPublishedContent(
      database,
      accountA,
      { type: 'blog', destination: null },
      1
    )
    assert.deepStrictEqual(keysOf(items), [
      `blog:${ids.wordpress}`,
      `blog:${ids.unrecorded}`
    ])
    assert.deepStrictEqual(counts.byDestination, {
      wordpress: 1,
      unrecorded: 1
    })
    assert.deepStrictEqual(
      { all: counts.all, social: counts.social, blog: counts.blog },
      { all: 4, social: 2, blog: 2 }
    )
  })

  it('narrows to one destination, whichever content type it serves', async () => {
    const unrecorded = await loadPublishedContent(
      database,
      accountA,
      { type: null, destination: 'unrecorded' },
      1
    )
    assert.deepStrictEqual(keysOf(unrecorded.items), [`blog:${ids.unrecorded}`])
    // The destination chips keep their counts while one is picked.
    assert.strictEqual(unrecorded.counts.byDestination.linkedin, 1)

    const instagram = await loadPublishedContent(
      database,
      accountA,
      { type: 'social', destination: 'instagram' },
      1
    )
    assert.deepStrictEqual(keysOf(instagram.items), [`social:${ids.instagram}`])
    assert.strictEqual(instagram.pageInfo.total, 1)
  })

  it("never shows another identity's content", async () => {
    const { items } = await loadPublishedContent(database, accountA, ALL, 1)
    const shown = new Set(items.map(item => item.id))
    assert.ok(!shown.has(ids.otherPost!))
    assert.ok(!shown.has(ids.otherBlog!))
    const theirs = await loadPublishedContent(database, accountB, ALL, 1)
    assert.deepStrictEqual(keysOf(theirs.items), [
      `blog:${ids.otherBlog}`,
      `social:${ids.otherPost}`
    ])
  })

  it('shows the last page for a page past the end', async () => {
    const { items, pageInfo } = await loadPublishedContent(
      database,
      accountA,
      ALL,
      5
    )
    assert.strictEqual(pageInfo.page, 1)
    assert.strictEqual(items.length, 4)
  })
})
