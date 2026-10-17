import {
  collectBannedWords,
  resolveLinkPlacement,
  type GenerationContext
} from '../context-blocks'
import { collectFigureSources } from '../skills/post-drafting/guard'
import type { LintOptions } from '~/lib/lint/run-linter'
import type { Idea } from '@/db/schema'

/**
 * The quality-check settings for a post, from the account's rules and the idea
 * it came from. Used when a draft is first written and again whenever it is
 * edited, so the checks always judge the text as it now stands.
 */
export function buildPostLintOptions(
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
  post: {
    hook: string
    body: string
    cta?: string | null
    firstComment?: string | null
    hashtags?: string[] | null
  },
  /** How many sources the post cites; the idea's evidence when not given. */
  citationsCount?: number
): LintOptions {
  const constraints = ctx.prefs.constraints
  return {
    hook: post.hook,
    body: post.body,
    cta: post.cta,
    firstComment: post.firstComment,
    hashtags: post.hashtags,
    linkPlacement: resolveLinkPlacement(ctx.primaryGoal),
    bannedWords: collectBannedWords(ctx),
    bannedTopics: ctx.prefs.guardrails.banned_topics,
    maxChars: constraints.max_chars,
    hookMaxChars: constraints.hook_max_chars,
    hashtagRange: constraints.hashtags,
    emojiLevel: constraints.emoji_level,
    ctaRequired: constraints.cta_required,
    citationsCount: citationsCount ?? idea?.supportingEvidence?.length ?? 0,
    minCitations: ctx.prefs.research.min_citations_per_post,
    figureSources: idea ? collectFigureSources(ctx, idea) : null
  }
}
