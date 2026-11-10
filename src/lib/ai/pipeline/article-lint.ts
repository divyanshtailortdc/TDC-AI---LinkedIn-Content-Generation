import type { ArticleSource, Idea } from '@/db/schema'
import type { ArticleBlock } from '@/lib/articles/blocks'
import type { ArticleLintOptions } from '~/lib/lint/article-linter'
import { writingSettingsForVoice } from '~/lib/lint/writing-rules'
import { collectBannedWords, type GenerationContext } from '../context-blocks'
import { collectArticleFigureSources } from '../skills/article-drafting/guard'
import { ARTICLE_TARGET_WORDS } from '../skills/article-drafting/prompt'

/**
 * The article checks' settings, from the account's rules, the idea and the
 * knowledge the article drew on. Used when it is generated and again on every
 * save, so the checks always judge the text as it now stands. On a save the
 * knowledge passages are the ones kept in the article's sources.
 */
export function buildArticleLintOptions(
  ctx: GenerationContext,
  idea: Pick<
    Idea,
    | 'title'
    | 'thesis'
    | 'hookConcept'
    | 'coreArgument'
    | 'whyNow'
    | 'supportingEvidence'
  > | null,
  knowledge: Array<{ content: string }>,
  article: {
    title: string
    subtitle?: string | null
    content: ArticleBlock[]
    callToAction?: string | null
  }
): ArticleLintOptions {
  return {
    title: article.title,
    subtitle: article.subtitle,
    content: article.content,
    callToAction: article.callToAction,
    bannedWords: collectBannedWords(ctx),
    bannedTopics: ctx.prefs.guardrails.banned_topics,
    emojiLevel: ctx.prefs.constraints.emoji_level,
    figureSources: idea
      ? collectArticleFigureSources(ctx, idea, knowledge)
      : null,
    evidenceTexts: (idea?.supportingEvidence || [])
      .filter(e => e.factType === 'sourced' && e.quote)
      .map(e => e.quote as string),
    writing: writingSettingsForVoice(ctx.voice, ctx.samplePosts),
    targetWords: ARTICLE_TARGET_WORDS
  }
}

/** The knowledge passages an article kept in its sources, for the checks on save. */
export const knowledgeOfSources = (
  sources: ArticleSource[] | null | undefined
) =>
  (sources || [])
    .filter(s => s.kind === 'knowledge' && s.claim)
    .map(s => ({ content: s.claim as string }))
