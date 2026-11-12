import {
  collectBannedWords,
  platformOf,
  resolveLinkPlacement,
  styleFor,
  type GenerationContext
} from '../context-blocks'
import { collectFigureSources } from '../skills/post-drafting/guard'
import { forFormat } from '../channel-context'
import { writingSettingsForVoice } from '~/lib/lint/writing-rules'
import type { LintOptions } from '~/lib/lint/run-linter'
import type { Idea } from '@/db/schema'
import {
  countChars,
  DEFAULT_FORMAT,
  FORMATS,
  isCasualStyle,
  limitedTexts,
  PLATFORMS,
  videoScriptOf,
  type FormatId,
  type LinkFallback
} from '@/lib/formats'

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
    platformName: platformOf(ctx).name,
    // Inviting followers to tag a friend is not a professional post's bait.
    ...(isCasualStyle(styleFor(ctx, platformOf(ctx).id))
      ? { engagementBaitSeverity: 'warning' as const }
      : {}),
    maxChars: constraints.max_chars,
    hookMaxChars: constraints.hook_max_chars,
    hashtagRange: constraints.hashtags,
    emojiLevel: constraints.emoji_level,
    ctaRequired: constraints.cta_required,
    citationsCount: citationsCount ?? idea?.supportingEvidence?.length ?? 0,
    minCitations: ctx.prefs.research.min_citations_per_post,
    figureSources: idea ? collectFigureSources(ctx, idea) : null,
    // Only third-party wording: a web source's own text. The model's restated
    // claims and the author's own pages are theirs to repeat.
    evidenceTexts: (idea?.supportingEvidence || [])
      .filter(e => e.factType === 'sourced' && e.quote)
      .map(e => e.quote as string),
    // The voice and the author's own posts decide which habits are theirs.
    writing: writingSettingsForVoice(ctx.voice, ctx.samplePosts)
  }
}

const FALLBACK_LABELS: Record<LinkFallback, string> = {
  first_comment: 'the first comment',
  reply: 'a reply',
  link_in_bio: 'the link in the bio'
}

/**
 * The checks for a post in any format. LinkedIn's are exactly
 * buildPostLintOptions; other formats keep every shared check (grounding,
 * banned words, copied text) and take their length, fold, hashtag and link
 * rules from the format's spec.
 */
export function buildFormatLintOptions(
  ctx: GenerationContext,
  formatId: FormatId,
  idea: Parameters<typeof buildPostLintOptions>[1],
  post: Parameters<typeof buildPostLintOptions>[2] & {
    /** A video's caption, title and shots. */
    payload?: Record<string, unknown> | null
  },
  citationsCount?: number
): LintOptions {
  const formatCtx = forFormat(ctx, formatId)
  const base = buildPostLintOptions(formatCtx, idea, post, citationsCount)
  if (formatId === DEFAULT_FORMAT) return base

  const spec = FORMATS[formatId]
  const text = {
    hook: post.hook,
    body: post.body,
    cta: post.cta,
    hashtags: post.hashtags,
    payload: post.payload
  }
  const script =
    spec.structure === 'script' ? videoScriptOf(text) : null
  return {
    ...base,
    platformName: PLATFORMS[spec.platform].label,
    // Judged by this format's platform, whatever LinkedIn's style is.
    engagementBaitSeverity: isCasualStyle(styleFor(ctx, spec.platform))
      ? 'warning'
      : undefined,
    maxChars: spec.limits.maxChars,
    hookMaxChars: spec.limits.foldChars,
    countChars: value => countChars(value, spec.limits.count),
    limitTexts: limitedTexts(formatId, text),
    partRange: spec.limits.parts ?? null,
    hashtagRange: spec.hashtags === 'voice' ? base.hashtagRange : spec.hashtags,
    // A thread's or a video's ask is in its last post or shot, not in a
    // separate call to action.
    ctaRequired: spec.structure === 'single' ? base.ctaRequired : false,
    limitLabel: script ? 'Caption' : null,
    video: script
      ? {
          seconds: script.seconds,
          targetSeconds: spec.limits.seconds?.target ?? 30,
          maxSeconds: spec.limits.seconds?.max ?? 60,
          caption: script.caption,
          title: spec.platform === 'youtube' ? script.title : null
        }
      : null,
    linkRule: {
      inBody: spec.links.inBody,
      fallbackLabel: FALLBACK_LABELS[spec.links.fallback]
    }
  }
}
