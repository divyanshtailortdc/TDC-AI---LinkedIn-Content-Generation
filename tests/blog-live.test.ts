import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import { runBlogGeneration } from '../src/lib/ai/pipeline/blog-run'
import { withAiSpend } from '../src/lib/ai/spend'
import { createClaimedBlog } from '../src/lib/blogs/claim'
import { docLinks, docOutline } from '../src/lib/blogs/doc'
import { seoSummary } from '../src/lib/blogs/seo'
import type { BlogBrief } from '../src/lib/blogs/types'
import { normalizeUrlForCompare } from '../src/lib/urls'

// A real blog, written by the model with web research: costs about
// $0.20-0.45. Runs only with BLOG_LIVE_TEST=1 and the keys in .env:
//   BLOG_LIVE_TEST=1 pnpm exec tsx --env-file=.env \
//     --require ./tests/support/server-only-stub.cjs --test tests/blog-live.test.ts
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]
const live = process.env.BLOG_LIVE_TEST === '1'

const BRIEF: BlogBrief = {
  topic: 'Reducing cart abandonment for small online stores',
  primaryKeyword: 'cart abandonment',
  secondaryKeywords: ['checkout design', 'abandoned cart email'],
  length: 'medium',
  style: 'how_to',
  audience: { audienceId: null, note: '' },
  research: true,
  knowledge: true,
  faq: true,
  instructions: '',
  caseDetails: ''
}

describe('writing a real blog', { skip: !live || !url }, () => {
  const client = postgres(url!, { max: 4, prepare: false, onnotice: () => {} })
  const database = drizzle(client, { schema })
  const tag = `qa-bloglive-${Date.now().toString(36)}`
  let accountId = ''
  const own = [
    'https://bloglive.example',
    'https://bloglive.example/trial',
    'https://bloglive.example/checkout'
  ]

  before(async () => {
    const [user] = await database
      .insert(schema.authUsersTable)
      .values({ name: 'QA Blog Live', email: `${tag}@example.test` })
      .returning()
    const [account] = await database
      .insert(schema.accountsTable)
      .values({
        userId: user!.id,
        name: 'Bloglive Shop Tools',
        handle: tag,
        headline: 'Checkout software for small online shops in India',
        accountType: 'company',
        company: 'Bloglive Shop Tools',
        websiteUrl: own[0],
        industry: 'E-commerce software'
      })
      .returning()
    accountId = account!.id
    await database
      .insert(schema.voiceConfigsTable)
      .values({ accountId, tone: 'candid', perspective: 'we' })
    await database.insert(schema.audiencesTable).values({
      accountId,
      name: 'Owners of small online shops',
      geography: 'India',
      painPoints: ['Shoppers leave at checkout']
    })
    await database.insert(schema.offeringsTable).values({
      accountId,
      name: 'One-page checkout',
      type: 'product',
      description: 'A one-page checkout with UPI, cards and cash on delivery.',
      url: own[2]
    })
    await database.insert(schema.knowledgeDocumentsTable).values({
      accountId,
      title: 'Our checkout guide',
      sourceType: 'text',
      content:
        'Our one-page checkout shows delivery fees on the product page, before the cart. It supports UPI, cards and cash on delivery in one step.',
      summary: 'How the checkout shows fees early and keeps to one page.',
      wordCount: 25
    })
  })
  after(async () => {
    await client`delete from accounts where handle = ${tag}`
    await client`delete from auth_users where email = ${`${tag}@example.test`}`
    await client.end()
    await (globalThis as { conn?: { end: () => Promise<void> } }).conn?.end()
  })

  it(
    'researches, writes, checks and saves an SEO-ready blog within the time limit',
    { timeout: 300_000 },
    async () => {
      const [goal] = await database
        .insert(schema.goalsTable)
        .values({
          accountId,
          title: 'Win checkout trials',
          objective: 'lead_generation',
          desiredAction: 'Start a free trial',
          targetUrl: own[1]
        })
        .returning()
      const created = await createClaimedBlog(database, {
        id: randomUUID(),
        accountId,
        ideaId: null,
        goalId: goal!.id,
        kind: 'blog',
        brief: BRIEF
      })
      assert.strictEqual(created.outcome, 'created')
      if (created.outcome !== 'created') return

      const started = Date.now()
      const outcome = await withAiSpend({ source: 'blogs', accountId }, () =>
        runBlogGeneration(created.claim)
      )
      const seconds = Math.round((Date.now() - started) / 1000)
      const [blog] = await database
        .select()
        .from(schema.blogsTable)
        .where(eq(schema.blogsTable.id, created.claim.blogId))
      assert.strictEqual(outcome, 'saved', blog?.generationError ?? '')
      const row = blog!

      const sections = docOutline(row.content).filter(h => h.level === 2)
      const allowed = [
        ...row.sources.flatMap(s => (s.url ? [s.url] : [])),
        ...own
      ].map(normalizeUrlForCompare)
      const links = docLinks(row.content)
      const seo = seoSummary(row.checks.filter(f => f.rule.startsWith('seo_')))
      console.log(
        JSON.stringify(
          {
            seconds,
            costUsd: row.usage.costUsd,
            words: row.wordCount,
            title: row.title,
            metaTitle: row.metaTitle,
            metaDescription: row.metaDescription,
            slug: row.slug,
            sections: sections.map(s => s.text),
            faq: row.faq.length,
            sources: row.sources.map(
              s =>
                `${s.id}${s.cited ? '*' : ''} ${s.rating?.label ?? s.origin}: ${s.url ?? s.title}`
            ),
            links,
            seo: `${seo.passed}/${seo.total}`,
            failing: row.checks
              .filter(f => !f.passed)
              .map(f => `${f.rule}: ${f.message}`),
            selfFlags: row.selfFlags
          },
          null,
          2
        )
      )

      assert.strictEqual(row.generationStatus, 'ready')
      assert.ok(seconds < 300, `took ${seconds} s`)
      assert.ok(row.title.length > 0)
      assert.ok(
        row.metaTitle.length > 0 && row.metaTitle.length <= 70,
        row.metaTitle
      )
      assert.ok(
        row.metaDescription.length >= 100 && row.metaDescription.length <= 180,
        row.metaDescription
      )
      assert.ok(sections.length >= 3, `${sections.length} sections`)
      assert.ok(
        row.faq.length >= 3 && row.faq.length <= 8,
        `${row.faq.length} FAQ entries`
      )
      for (const link of links) {
        assert.ok(
          allowed.includes(normalizeUrlForCompare(link)),
          `link not in the pool or own: ${link}`
        )
      }
      const spend = await database
        .select()
        .from(schema.aiUsageTable)
        .where(
          and(
            eq(schema.aiUsageTable.accountId, accountId),
            eq(schema.aiUsageTable.source, 'blogs')
          )
        )
      assert.ok(spend.length > 0, 'AI spend recorded under blogs')
    }
  )
})
