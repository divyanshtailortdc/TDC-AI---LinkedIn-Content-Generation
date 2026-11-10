import 'server-only'

import { db } from '@/db'
import {
  articlesTable,
  ideasTable,
  runStepsTable,
  type Idea
} from '@/db/schema'
import {
  articleToPlainText,
  countArticleWords,
  inlineToText
} from '@/lib/articles/blocks'
import {
  failArticleGeneration,
  saveGeneratedArticle,
  snapshotOf,
  type ArticleClaim
} from '@/lib/articles/claim'
import { eq } from 'drizzle-orm'
import { EMPTY_USAGE, getLanguageModel } from '~/lib/ai'
import { blockingFindings, runArticleLinter } from '~/lib/lint/article-linter'
import type { LintFinding } from '~/lib/lint/run-linter'
import { loadIdeaContext, type GenerationContext } from '../context'
import { retrieveKnowledgePassages } from '../embeddings'
import { refreshRunTotals } from '../run-accounting'
import { SkillError } from '../run-skill'
import {
  writeArticle,
  type ArticleGenerationResult
} from '../skills/article-drafting'
import {
  articleSources,
  toArticleBlocks,
  type ArticleKnowledgePassage
} from '../skills/article-drafting/guard'
import { addUsage, type CallUsage } from '../usage'
import { buildArticleLintOptions } from './article-lint'

/**
 * Writes a claimed article (see src/lib/articles/claim.ts): the idea's
 * context (the same identity, voice, goals, audience and history a post
 * gets), the knowledge-base passages closest to the idea, one model call for
 * the structured article, the article checks with one revision pass when a
 * blocking check fails and time allows, then the save.
 *
 * Its spend is recorded as an `article_drafting` step on the idea's run, so
 * it reaches the run's totals and every usage summary built from them, and
 * on the article itself.
 */

/** Passages the article gets from the knowledge base. */
const KNOWLEDGE_PASSAGES = 8
/** Only revise while there is time left in a 300-second function. */
const REVISION_BUDGET_MS = 75_000

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(w => w.length > 3)
  )

/**
 * The knowledge-base passages closest to the idea: by embedding when the
 * gateway is configured, otherwise the documents whose summary, topics and
 * claims share the most words with the idea.
 */
export async function loadArticleKnowledge(
  ctx: GenerationContext,
  idea: Pick<
    Idea,
    'title' | 'hook' | 'thesis' | 'coreArgument' | 'audienceTakeaway' | 'angle'
  >
): Promise<ArticleKnowledgePassage[]> {
  const docs = ctx.knowledgeDocs
  if (docs.length === 0) return []
  const byId = new Map(docs.map(d => [d.id, d]))
  const queries = [
    [idea.title || idea.hook, idea.thesis].filter(Boolean).join('\n'),
    idea.coreArgument || '',
    [idea.angle, idea.audienceTakeaway].filter(Boolean).join('\n')
  ].filter(q => q.trim())

  const passages = await retrieveKnowledgePassages(ctx, docs, {
    queries,
    limit: KNOWLEDGE_PASSAGES
  })
  if (passages.length > 0) {
    return passages.map(p => ({
      documentId: p.documentId,
      title: byId.get(p.documentId)?.title || 'Knowledge base',
      url: byId.get(p.documentId)?.sourceUrl || null,
      content: p.content
    }))
  }

  // No embeddings: rank the documents by the words they share with the idea.
  const ideaWords = words(queries.join('\n'))
  return docs
    .map(doc => {
      const claims = (doc.keyClaims || []).map(c => c.claim)
      const text = [
        doc.title,
        doc.summary || '',
        ...(doc.topics || []),
        ...claims
      ].join('\n')
      let score = 0
      for (const w of words(text)) if (ideaWords.has(w)) score++
      return {
        doc,
        score,
        text: [doc.summary || '', ...claims].filter(Boolean).join('\n')
      }
    })
    .filter(d => d.score > 1 && d.text.trim())
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ doc, text }) => ({
      documentId: doc.id,
      title: doc.title,
      url: doc.sourceUrl || null,
      content: text
    }))
}

/**
 * Charges a model call made for an article to the run that made its idea, as
 * a step of its own. Never throws: losing a line of accounting must not fail
 * the article. Ideas without a run (none are made that way today) keep the
 * spend on the article row only.
 */
export async function recordArticleSpend(input: {
  runId: string | null
  stage: 'article_drafting' | 'media'
  articleId: string
  usage: CallUsage
  summary: string
  startedAt: Date
  error?: string | null
  details?: Record<string, unknown>
}) {
  if (!input.runId || input.usage.calls === 0) return
  try {
    await db.insert(runStepsTable).values({
      runId: input.runId,
      stage: input.stage,
      status: input.error ? 'failed' : 'completed',
      startedAt: input.startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - input.startedAt.getTime(),
      requestSummary: input.summary,
      error: input.error ?? null,
      tokens: input.usage.totalTokens,
      costUsd: input.usage.costUsd.toFixed(4),
      responseJson: {
        contentType: 'article',
        articleId: input.articleId,
        ...input.details,
        usage: input.usage
      }
    })
    await refreshRunTotals(input.runId)
  } catch (err) {
    console.error(`Could not record spend for article ${input.articleId}:`, err)
  }
}

/**
 * Generates a claimed article and saves it, or records why it failed. Never
 * throws: the outcome is on the article row, which the page polls.
 */
export async function generateClaimedArticle(
  claim: ArticleClaim
): Promise<void> {
  const startedAt = new Date()
  let usage: CallUsage = EMPTY_USAGE
  let runId: string | null = null
  let summary = 'Article'
  const model = getLanguageModel('article_drafting')?.modelId ?? null

  const fail = async (message: string) => {
    await failArticleGeneration(db, claim, message, usage).catch(err =>
      console.error(
        `Could not record the failure of article ${claim.articleId}:`,
        err
      )
    )
    await recordArticleSpend({
      runId,
      stage: 'article_drafting',
      articleId: claim.articleId,
      usage,
      summary,
      startedAt,
      error: message,
      details: { model }
    })
  }

  try {
    const article = await db.query.articlesTable.findFirst({
      where: eq(articlesTable.id, claim.articleId)
    })
    if (!article) return
    const idea = article.ideaId
      ? await db.query.ideasTable.findFirst({
          where: eq(ideasTable.id, article.ideaId)
        })
      : null
    if (!idea) {
      await fail('The idea this article was written from no longer exists.')
      return
    }
    runId = idea.runId
    summary = `Article for "${idea.title || idea.hook}"`

    if (!model) {
      await fail(
        'No AI provider configured. Add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to generate articles.'
      )
      return
    }

    const ctx = await loadIdeaContext(idea, { platform: article.platform })
    const passages = await loadArticleKnowledge(ctx, idea)
    const brief = {
      ctx,
      idea,
      passages,
      guidance: article.guidance,
      previous:
        article.generationCount > 0 && (article.content ?? []).length > 0
          ? snapshotOf(article)
          : null
    }

    let output: ArticleGenerationResult
    try {
      const written = await writeArticle(brief)
      usage = addUsage(usage, written.usage)
      output = written.article
    } catch (err) {
      if (err instanceof SkillError) usage = addUsage(usage, err.usage)
      await fail(
        err instanceof Error ? err.message : 'Article generation failed.'
      )
      return
    }

    const build = (out: ArticleGenerationResult) => {
      const content = toArticleBlocks(out)
      const draft = {
        title: out.title.trim(),
        subtitle: out.subtitle.trim(),
        content,
        callToAction: out.callToAction.trim() || null
      }
      const findings: LintFinding[] = runArticleLinter(
        buildArticleLintOptions(ctx, idea, passages, draft)
      )
      return { out, draft, findings }
    }

    let result = build(output)
    let revised = false
    const blocking = blockingFindings(result.findings)
    if (
      blocking.length > 0 &&
      Date.now() - startedAt.getTime() < REVISION_BUDGET_MS
    ) {
      try {
        const revision = await writeArticle(brief, {
          draft: {
            title: result.draft.title,
            text: articleToPlainText({ content: result.draft.content })
          },
          failedChecks: blocking.map(f => f.message)
        })
        usage = addUsage(usage, revision.usage)
        const candidate = build(revision.article)
        if (blockingFindings(candidate.findings).length < blocking.length) {
          result = candidate
          revised = true
        }
      } catch (err) {
        // A failed revision still cost; the first version stands.
        if (err instanceof SkillError) usage = addUsage(usage, err.usage)
        console.warn(
          `Revision of article ${claim.articleId} failed; keeping the first version:`,
          err
        )
      }
    }

    const { out, draft, findings } = result
    const saved = await saveGeneratedArticle(
      db,
      claim,
      {
        ...draft,
        wordCount: countArticleWords(draft.content),
        coverSuggestion: {
          concept: out.coverImage.concept.trim(),
          altText: out.coverImage.altText.trim()
        },
        coverImageAlt: out.coverImage.altText.trim() || null,
        promoPost: out.promoPost.trim() || null,
        sources: articleSources(idea, passages, out.sourcesUsed),
        lintFindings: findings,
        selfFlags: (out.selfFlags || []).filter(Boolean),
        model
      },
      usage
    )

    await recordArticleSpend({
      runId,
      stage: 'article_drafting',
      articleId: claim.articleId,
      usage,
      summary,
      startedAt,
      details: {
        model,
        revised,
        saved,
        words: countArticleWords(draft.content),
        knowledgePassages: passages.length,
        title: inlineToText(draft.title).slice(0, 200)
      }
    })
    if (!saved) {
      console.warn(
        `Article ${claim.articleId} was generated after its claim was lost (deleted or taken over); the result was dropped.`
      )
    }
  } catch (err) {
    console.error(`Generating article ${claim.articleId} failed:`, err)
    await fail('Something went wrong while generating the article. Try again.')
  }
}
