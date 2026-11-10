import 'server-only'

import type { ArticleSnapshot, Idea } from '@/db/schema'
import type { GenerationContext } from '../../context'
import { runSkill, SkillError } from '../../run-skill'
import type { CallUsage } from '../../usage'
import { isCompleteArticle, type ArticleKnowledgePassage } from './guard'
import {
  buildArticleInstructions,
  buildArticlePrompt,
  buildArticleRevisionPrompt
} from './prompt'
import { ArticleGenerationSchema, type ArticleGenerationResult } from './schema'

export type { ArticleGenerationResult } from './schema'

/**
 * A bound on one article call, retries included, so a call that never
 * answers fails the article instead of holding it "generating". An article
 * takes one to two minutes; this leaves room inside a function's 300 seconds
 * for saving and the bookkeeping.
 */
const ARTICLE_TIMEOUT_MS = 210_000

export type ArticleBrief = {
  ctx: GenerationContext
  idea: Idea
  passages: ArticleKnowledgePassage[]
  /** The reviewer's direction for a regeneration. */
  guidance?: string | null
  /** The version a regeneration replaces. */
  previous?: ArticleSnapshot | null
}

/**
 * Skill: an approved idea, the account's settings and the knowledge
 * retrieved for it in; a structured long-form article (title, subtitle,
 * introduction, sections, closing, call to action, cover suggestion, promo
 * post) out. Pass `revise` for the single revision pass: the last version as
 * text and the checks it failed.
 *
 * Throws SkillError on failure or an incomplete article; its usage is what
 * that attempt cost.
 */
export async function writeArticle(
  brief: ArticleBrief,
  revise?: { draft: { title: string; text: string }; failedChecks: string[] }
): Promise<{
  article: ArticleGenerationResult
  usage: CallUsage
  modelId: string
}> {
  const options = {
    passages: brief.passages,
    guidance: brief.guidance,
    previous: brief.previous
  }
  const { output, usage, modelId } = await runSkill({
    stage: 'article_drafting',
    instructions: buildArticleInstructions(brief.ctx),
    cacheInstructions: true,
    prompt: revise
      ? buildArticleRevisionPrompt(
          brief.ctx,
          brief.idea,
          options,
          revise.draft,
          revise.failedChecks
        )
      : buildArticlePrompt(brief.ctx, brief.idea, options),
    schema: ArticleGenerationSchema,
    timeoutMs: ARTICLE_TIMEOUT_MS,
    maxRetries: 1
  })

  if (!isCompleteArticle(output)) {
    throw new SkillError(
      'The model returned an incomplete article.',
      'failed',
      {
        usage
      }
    )
  }
  return { article: output, usage, modelId }
}
