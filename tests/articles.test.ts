import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import { refreshRunTotalsIn } from '../src/lib/ai/review-spend'
import { EMPTY_USAGE, type CallUsage } from '../src/lib/ai/usage'
import {
  claimArticleForIdea,
  claimArticleRegeneration,
  expireStaleGeneration,
  failArticleGeneration,
  saveGeneratedArticle,
  type GeneratedArticleValues
} from '../src/lib/articles/claim'
import { ARTICLE_GENERATION_STALE_MS } from '../src/lib/articles/status'
import { findOwnedArticle, findOwnedIdea } from '../src/lib/ownership'
import { saveConnection } from '../src/lib/publishing/connection'
import {
  claimPublication,
  executePublication,
  PublishRequestError,
  requestPublication
} from '../src/lib/publishing/engine'
import type { LinkedInAppConfig } from '../src/lib/publishing/linkedin/oauth'

/**
 * Articles against a real database. Runs only when DATABASE_URL is set in the
 * environment (never from .env, which may be a shared database); every row it
 * makes is removed. The live part (a real model call) also needs
 * ARTICLE_LIVE_TEST=1 and AI_GATEWAY_API_KEY, so it never spends by accident.
 */

const url = process.env.DATABASE_URL
const tag = `qa-art-${Date.now().toString(36)}`

const usage = (costUsd: number, outputTokens = 1000): CallUsage => ({
  ...EMPTY_USAGE,
  calls: 1,
  inputTokens: 2000,
  noCacheInputTokens: 2000,
  outputTokens,
  totalTokens: 2000 + outputTokens,
  costUsd,
  billedCalls: 1
})

const values = (title: string): GeneratedArticleValues => ({
  title,
  subtitle: `${title} subtitle`,
  content: [
    { type: 'paragraph', text: `${title} intro` },
    { type: 'heading', level: 2, text: 'Section' },
    { type: 'paragraph', text: 'Body' }
  ],
  callToAction: 'Try it',
  wordCount: 5,
  coverSuggestion: { concept: 'A shelf', altText: 'Shelf' },
  coverImageAlt: 'Shelf',
  promoPost: 'Read this.',
  sources: [],
  lintFindings: [],
  selfFlags: [],
  model: 'anthropic/claude-sonnet-5-5'
})

describe('articles', { skip: !url }, () => {
  const client = postgres(url!, { max: 6, prepare: false })
  const database = drizzle(client, { schema })

  const newUser = async (name: string) => {
    const [user] = await database
      .insert(schema.authUsersTable)
      .values({ name, email: `${tag}-${name}@example.com`, emailVerified: true })
      .returning()
    const [account] = await database
      .insert(schema.accountsTable)
      .values({ userId: user!.id, name, handle: `${tag}-${name}`, headline: 'QA' })
      .returning()
    const [run] = await database
      .insert(schema.runsTable)
      .values({ accountId: account!.id, status: 'completed' })
      .returning()
    return { userId: user!.id, accountId: account!.id, runId: run!.id }
  }
  const newIdea = async (
    owner: { accountId: string; runId: string },
    status = 'approved'
  ) => {
    const [idea] = await database
      .insert(schema.ideasTable)
      .values({
        accountId: owner.accountId,
        runId: owner.runId,
        title: 'How AI is transforming the ecommerce industry',
        hook: 'QA hook',
        status
      })
      .returning()
    return idea!
  }
  const articleRow = async (id: string) =>
    (
      await database
        .select()
        .from(schema.articlesTable)
        .where(eq(schema.articlesTable.id, id))
    )[0]!

  let a: Awaited<ReturnType<typeof newUser>>
  let b: Awaited<ReturnType<typeof newUser>>

  before(async () => {
    a = await newUser('a')
    b = await newUser('b')
  })
  after(async () => {
    await client`delete from auth_users where email like ${`${tag}-%`}`
    await client.end()
  })

  describe('generation claims', () => {
    it('starts one article per idea, however many requests race', async () => {
      const idea = await newIdea(a)
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          claimArticleForIdea(database, {
            accountId: a.accountId,
            ideaId: idea.id,
            title: idea.title
          })
        )
      )
      assert.strictEqual(results.filter(r => r.outcome === 'claimed').length, 1)
      assert.strictEqual(new Set(results.map(r => r.articleId)).size, 1)
      const rows = await database
        .select({ id: schema.articlesTable.id })
        .from(schema.articlesTable)
        .where(eq(schema.articlesTable.ideaId, idea.id))
      assert.strictEqual(rows.length, 1)
    })

    it('saves the result, then opens it rather than generating again', async () => {
      const idea = await newIdea(a)
      const claim = await claimArticleForIdea(database, {
        accountId: a.accountId,
        ideaId: idea.id
      })
      assert.strictEqual(claim.outcome, 'claimed')
      if (claim.outcome !== 'claimed') return
      assert.ok(
        await saveGeneratedArticle(database, claim, values('First'), usage(0.12))
      )
      const row = await articleRow(claim.articleId)
      assert.strictEqual(row.generationStatus, 'ready')
      assert.strictEqual(row.generationCount, 1)
      assert.strictEqual(row.title, 'First')
      assert.strictEqual(row.original?.title, 'First')
      assert.strictEqual(row.previousVersion, null)
      assert.strictEqual(Number(row.usage.costUsd), 0.12)
      // The idea's post state is untouched: an article is a second format.
      const [ideaAfter] = await database
        .select({ status: schema.ideasTable.status })
        .from(schema.ideasTable)
        .where(eq(schema.ideasTable.id, idea.id))
      assert.strictEqual(ideaAfter!.status, 'approved')

      const again = await claimArticleForIdea(database, {
        accountId: a.accountId,
        ideaId: idea.id
      })
      assert.deepStrictEqual(again, { outcome: 'exists', articleId: claim.articleId })
    })

    it('regenerates in place, once at a time, keeping the replaced version', async () => {
      const idea = await newIdea(a, 'drafted')
      const first = await claimArticleForIdea(database, {
        accountId: a.accountId,
        ideaId: idea.id
      })
      if (first.outcome !== 'claimed') assert.fail('claimed')
      await saveGeneratedArticle(database, first, values('V1'), usage(0.1))
      // The reviewer edits, then regenerates twice at once.
      await database
        .update(schema.articlesTable)
        .set({ title: 'V1 edited' })
        .where(eq(schema.articlesTable.id, first.articleId))
      const claims = await Promise.all([
        claimArticleRegeneration(database, {
          accountId: a.accountId,
          articleId: first.articleId,
          guidance: 'Shorter'
        }),
        claimArticleRegeneration(database, {
          accountId: a.accountId,
          articleId: first.articleId
        })
      ])
      const won = claims.filter(Boolean)
      assert.strictEqual(won.length, 1)
      assert.ok(await saveGeneratedArticle(database, won[0]!, values('V2'), usage(0.2)))

      const row = await articleRow(first.articleId)
      assert.strictEqual(row.title, 'V2')
      assert.strictEqual(row.generationCount, 2)
      assert.strictEqual(row.previousVersion?.title, 'V1 edited')
      assert.ok(Math.abs(Number(row.usage.costUsd) - 0.3) < 1e-9)
      const all = await database
        .select({ id: schema.articlesTable.id })
        .from(schema.articlesTable)
        .where(eq(schema.articlesTable.ideaId, idea.id))
      assert.strictEqual(all.length, 1, 'no duplicate article')
    })

    it('drops a result whose claim was taken over, and keeps text on failure', async () => {
      const idea = await newIdea(a)
      const first = await claimArticleForIdea(database, {
        accountId: a.accountId,
        ideaId: idea.id
      })
      if (first.outcome !== 'claimed') assert.fail('claimed')
      await saveGeneratedArticle(database, first, values('Kept'), usage(0.1))

      const slow = await claimArticleRegeneration(database, {
        accountId: a.accountId,
        articleId: first.articleId
      })
      assert.ok(slow)
      // Still generating: not claimable until stale.
      assert.strictEqual(
        await claimArticleRegeneration(database, {
          accountId: a.accountId,
          articleId: first.articleId
        }),
        null
      )
      const later = new Date(Date.now() + ARTICLE_GENERATION_STALE_MS + 60_000)
      assert.ok(await expireStaleGeneration(database, first.articleId, later))
      const retry = await claimArticleRegeneration(
        database,
        { accountId: a.accountId, articleId: first.articleId },
        later
      )
      assert.ok(retry)
      // The slow generation finishes after the take-over: dropped.
      assert.strictEqual(
        await saveGeneratedArticle(database, slow!, values('Stale'), usage(0.05)),
        false
      )
      // The retry fails: the earlier text stays, marked failed.
      assert.ok(await failArticleGeneration(database, retry!, 'Model timed out', usage(0.02)))
      const row = await articleRow(first.articleId)
      assert.strictEqual(row.title, 'Kept')
      assert.strictEqual(row.generationStatus, 'failed')
      assert.strictEqual(row.generationError, 'Model timed out')
      assert.ok(Math.abs(Number(row.usage.costUsd) - 0.12) < 1e-9)
      // A failed article can be started again from the idea.
      const reclaim = await claimArticleForIdea(database, {
        accountId: a.accountId,
        ideaId: idea.id
      })
      assert.strictEqual(reclaim.outcome, 'claimed')
    })
  })

  describe('data isolation', () => {
    it("does not find another user's article or idea", async () => {
      const idea = await newIdea(a)
      const claim = await claimArticleForIdea(database, {
        accountId: a.accountId,
        ideaId: idea.id
      })
      assert.ok(await findOwnedArticle(database, a.userId, claim.articleId))
      assert.strictEqual(await findOwnedArticle(database, b.userId, claim.articleId), undefined)
      assert.strictEqual(await findOwnedIdea(database, b.userId, idea.id), undefined)
      assert.strictEqual(await findOwnedArticle(database, b.userId, 'not-a-uuid'), undefined)
    })

    it("cannot claim another account's article or idea", async () => {
      const idea = await newIdea(a)
      const claim = await claimArticleForIdea(database, {
        accountId: a.accountId,
        ideaId: idea.id
      })
      if (claim.outcome !== 'claimed') assert.fail('claimed')
      await saveGeneratedArticle(database, claim, values('A only'), usage(0))
      assert.strictEqual(
        await claimArticleRegeneration(database, {
          accountId: b.accountId,
          articleId: claim.articleId
        }),
        null
      )
      await assert.rejects(
        claimArticleForIdea(database, { accountId: b.accountId, ideaId: idea.id }),
        /Article not found/
      )
    })
  })

  describe('usage tracking', () => {
    it("adds article spend to the idea's run totals beside post drafting", async () => {
      const owner = await newUser('spend')
      const draft = usage(0.03, 400)
      const article = usage(0.15, 3000)
      await database.insert(schema.runStepsTable).values([
        {
          runId: owner.runId,
          stage: 'drafting',
          status: 'completed',
          tokens: draft.totalTokens,
          costUsd: draft.costUsd.toFixed(4),
          responseJson: { usage: draft }
        },
        {
          runId: owner.runId,
          stage: 'article_drafting',
          status: 'completed',
          tokens: article.totalTokens,
          costUsd: article.costUsd.toFixed(4),
          responseJson: { contentType: 'article', usage: article }
        }
      ])
      const total = await refreshRunTotalsIn(database, owner.runId)
      assert.ok(Math.abs(total.costUsd - 0.18) < 1e-9)
      assert.strictEqual(total.outputTokens, 3400)
      const [run] = await database
        .select({ costUsd: schema.runsTable.costUsd })
        .from(schema.runsTable)
        .where(eq(schema.runsTable.id, owner.runId))
      assert.strictEqual(run!.costUsd, '0.1800')
    })
  })

  describe('publishing', () => {
    const config: LinkedInAppConfig = {
      clientId: 'client',
      clientSecret: 'secret',
      redirectUri: 'https://app.example.com/api/integrations/linkedin/callback',
      scopes: ['openid', 'profile', 'w_member_social'],
      apiVersion: '202610',
      encryptionKey: randomBytes(32)
    }
    const bodies: any[] = []
    const fetchFn = (async (input: string | URL, init: RequestInit = {}) => {
      const href = String(input)
      if (href.endsWith('/rest/posts')) {
        bodies.push(JSON.parse(String(init.body)))
        return new Response(null, {
          status: 201,
          headers: { 'x-restli-id': `urn:li:share:${bodies.length}` }
        })
      }
      if (href.includes('/rest/images?action=initializeUpload')) {
        return Response.json({
          value: { uploadUrl: 'https://upload.example/img', image: 'urn:li:image:THUMB' }
        })
      }
      if (href === 'https://upload.example/img') return new Response(null, { status: 201 })
      return new Response('not found', { status: 404 })
    }) as typeof fetch
    const deps = (withImage: boolean) => ({
      database,
      configs: { linkedin: config },
      fetchFn,
      loadImage: async () =>
        withImage
          ? { bytes: Buffer.from('png'), mediaType: 'image/png', altText: 'Cover' }
          : null
    })
    const newPost = async (overrides: Partial<schema.NewPostDraft> = {}) => {
      const [draft] = await database
        .insert(schema.postDraftsTable)
        .values({
          accountId: a.accountId,
          hook: 'A hook',
          body: 'A body',
          originalHook: 'A hook',
          originalBody: 'A body',
          status: 'approved',
          ...overrides
        })
        .returning()
      return draft!.id
    }
    const publish = async (draftId: string, withImage = false) => {
      const row = await requestPublication(database, {
        userId: a.userId,
        draftId,
        trigger: 'manual',
        scheduledAt: new Date()
      })
      const claimed = await claimPublication(database, row.id)
      assert.ok(claimed)
      return executePublication(deps(withImage), claimed)
    }

    before(async () => {
      await saveConnection(
        database,
        config,
        a.userId,
        {
          accessToken: 'AT',
          accessTokenExpiresAt: new Date(Date.now() + 30 * 86400_000),
          refreshToken: null,
          refreshTokenExpiresAt: null,
          scopes: ['openid', 'profile', 'w_member_social']
        },
        { memberId: 'MEMBER_A', name: 'A', pictureUrl: null }
      )
    })

    it('publishes an article-link post as a link card with the cover as thumbnail', async () => {
      const idea = await newIdea(a)
      const claim = await claimArticleForIdea(database, {
        accountId: a.accountId,
        ideaId: idea.id
      })
      const draftId = await newPost({
        articleId: claim.articleId,
        ideaId: idea.id,
        linkUrl: 'https://kartly.example/blog/ai',
        linkTitle: 'AI in ecommerce',
        linkDescription: 'Why data comes first'
      })
      const result = await publish(draftId, true)
      assert.strictEqual(result.status, 'published', result.error ?? '')
      const body = bodies.at(-1)
      assert.deepStrictEqual(body.content, {
        article: {
          source: 'https://kartly.example/blog/ai',
          title: 'AI in ecommerce',
          description: 'Why data comes first',
          thumbnail: 'urn:li:image:THUMB'
        }
      })
      assert.ok(!('media' in body.content))
    })

    it('publishes a plain post exactly as before', async () => {
      const result = await publish(await newPost())
      assert.strictEqual(result.status, 'published')
      assert.ok(!('content' in bodies.at(-1)))
      const withImage = await publish(await newPost(), true)
      assert.strictEqual(withImage.status, 'published')
      assert.deepStrictEqual(bodies.at(-1).content, {
        media: { id: 'urn:li:image:THUMB', altText: 'Cover' }
      })
    })

    it('refuses a link post whose address is not http(s)', async () => {
      const draftId = await newPost({ linkUrl: 'javascript:alert(1)', linkTitle: 'Bad' })
      await assert.rejects(
        requestPublication(database, {
          userId: a.userId,
          draftId,
          trigger: 'manual',
          scheduledAt: new Date()
        }),
        (err: unknown) => err instanceof PublishRequestError
      )
    })

    it('never treats a native article as a publishable post', async () => {
      const idea = await newIdea(a)
      const claim = await claimArticleForIdea(database, {
        accountId: a.accountId,
        ideaId: idea.id
      })
      // An article's id is not a post: publishing goes through post_drafts only.
      await assert.rejects(
        requestPublication(database, {
          userId: a.userId,
          draftId: claim.articleId,
          trigger: 'manual',
          scheduledAt: new Date()
        }),
        (err: unknown) =>
          err instanceof PublishRequestError && err.code === 'not_found'
      )
      const publications = await database
        .select({ id: schema.publicationsTable.id })
        .from(schema.publicationsTable)
        .where(eq(schema.publicationsTable.draftId, claim.articleId))
      assert.strictEqual(publications.length, 0)
    })

    it('keeps link posts when their article is deleted', async () => {
      const idea = await newIdea(a)
      const claim = await claimArticleForIdea(database, {
        accountId: a.accountId,
        ideaId: idea.id
      })
      const draftId = await newPost({
        articleId: claim.articleId,
        linkUrl: 'https://kartly.example/x',
        linkTitle: 'X'
      })
      await database
        .delete(schema.articlesTable)
        .where(eq(schema.articlesTable.id, claim.articleId))
      const [post] = await database
        .select({ articleId: schema.postDraftsTable.articleId, linkUrl: schema.postDraftsTable.linkUrl })
        .from(schema.postDraftsTable)
        .where(eq(schema.postDraftsTable.id, draftId))
      assert.deepStrictEqual(post, { articleId: null, linkUrl: 'https://kartly.example/x' })
    })
  })

  describe(
    'live generation (a real model call)',
    { skip: process.env.ARTICLE_LIVE_TEST !== '1' || !process.env.AI_GATEWAY_API_KEY },
    () => {
      it('writes a post and an article from the same idea, with the identity, knowledge and spend', async () => {
        const { generateClaimedArticle } = await import('../src/lib/ai/pipeline/article-run')
        const { draftClaimedIdeaOrRelease } = await import('../src/lib/ai/pipeline/drafting-run')
        const { claimIdeaForDrafting } = await import('../src/lib/ai/pipeline/drafting-claim')

        const owner = await newUser('live')
        await database
          .update(schema.accountsTable)
          .set({
            name: 'Meera Rao',
            headline: 'Head of growth at Kartly, a D2C ecommerce platform',
            company: 'Kartly',
            industry: 'Ecommerce'
          })
          .where(eq(schema.accountsTable.id, owner.accountId))
        await database.insert(schema.voiceConfigsTable).values({
          accountId: owner.accountId,
          tone: 'warm-analytical',
          perspective: 'I',
          bannedWords: ['synergize'],
          derivedStyleRubric: 'Short declarative openers. Concrete retail examples.'
        })
        await database.insert(schema.knowledgeDocumentsTable).values({
          accountId: owner.accountId,
          title: 'Kartly catalogue playbook',
          sourceType: 'text',
          content:
            'Kartly cut product returns by 18% after normalising size and colour attributes across 40,000 SKUs. Recommendation click-through rose once duplicate listings were merged.',
          summary:
            'Kartly normalised catalogue attributes for ecommerce AI: returns fell 18%, recommendations improved after merging duplicate listings.',
          topics: ['ecommerce', 'catalogue data', 'AI recommendations', 'returns'],
          keyClaims: [
            {
              claim: 'Kartly cut product returns by 18% after normalising size attributes',
              quote: 'cut product returns by 18%'
            }
          ]
        })
        const [idea] = await database
          .insert(schema.ideasTable)
          .values({
            accountId: owner.accountId,
            runId: owner.runId,
            title: 'How AI is transforming the ecommerce industry',
            hook: 'AI in ecommerce pays off only on clean catalogue data',
            thesis: 'Ecommerce AI pays off where product data is clean.',
            coreArgument: 'Fix catalogue attributes before buying AI tools.',
            audienceTakeaway: 'Audit product attributes first.',
            status: 'approved',
            suggestedMedia: { mode: 'none' }
          })
          .returning()

        // 1. The post, through the unchanged post pipeline.
        assert.ok(await claimIdeaForDrafting(database, idea!.id))
        const post = await draftClaimedIdeaOrRelease(idea!.id)
        assert.ok(post.draftId)

        // 2. The article, from the same idea.
        const claim = await claimArticleForIdea(database, {
          accountId: owner.accountId,
          ideaId: idea!.id,
          title: idea!.title
        })
        if (claim.outcome !== 'claimed') assert.fail('claimed')
        await generateClaimedArticle(claim)
        const article = await articleRow(claim.articleId)
        assert.strictEqual(article.generationStatus, 'ready', article.generationError ?? '')
        assert.ok(article.title.length > 0)
        assert.ok(article.wordCount > 500, `words: ${article.wordCount}`)
        assert.ok(article.content.filter(b => b.type === 'heading').length >= 3)
        assert.ok(
          article.sources.some(s => s.kind === 'knowledge' && s.title === 'Kartly catalogue playbook'),
          'the knowledge base reached the article'
        )
        assert.ok(Number(article.usage.costUsd) > 0)

        // Both formats belong to the idea; the idea is drafted (its post).
        const [ideaAfter] = await database
          .select({ status: schema.ideasTable.status })
          .from(schema.ideasTable)
          .where(eq(schema.ideasTable.id, idea!.id))
        assert.strictEqual(ideaAfter!.status, 'drafted')
        const posts = await database
          .select({ id: schema.postDraftsTable.id })
          .from(schema.postDraftsTable)
          .where(eq(schema.postDraftsTable.ideaId, idea!.id))
        assert.strictEqual(posts.length, 1)

        // Spend: a step of its own on the run, in the run's totals.
        const steps = await database
          .select({ stage: schema.runStepsTable.stage, costUsd: schema.runStepsTable.costUsd })
          .from(schema.runStepsTable)
          .where(
            and(
              eq(schema.runStepsTable.runId, owner.runId),
              eq(schema.runStepsTable.stage, 'article_drafting')
            )
          )
        assert.strictEqual(steps.length, 1)
        const [run] = await database
          .select({ costUsd: schema.runsTable.costUsd })
          .from(schema.runsTable)
          .where(eq(schema.runsTable.id, owner.runId))
        assert.ok(Number(run!.costUsd) >= Number(steps[0]!.costUsd))

        console.log(
          JSON.stringify(
            {
              title: article.title,
              subtitle: article.subtitle,
              words: article.wordCount,
              headings: article.content
                .filter(b => b.type === 'heading')
                .map(b => (b as { text: string }).text),
              sources: article.sources.map(s => `${s.kind}:${s.title}:${s.used}`),
              failedChecks: article.lintFindings.filter(f => !f.passed).map(f => f.message),
              articleCostUsd: article.usage.costUsd,
              runCostUsd: run!.costUsd,
              model: article.model
            },
            null,
            2
          )
        )
      })
    }
  )
})
