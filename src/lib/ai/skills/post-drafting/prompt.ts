import type { MediaFormat } from '@/lib/formats/types'
import type { Idea } from '@/db/schema'
import {
  describeCta,
  describeHashtags,
  platformOf,
  renderAlsoSupportsBlock,
  renderAudienceBlock,
  renderConstraintsBlock,
  renderGoalBlock,
  renderGuardrailsBlock,
  renderIdentityBlock,
  renderReviewerFeedbackBlock,
  renderVoiceBlock,
  resolveLinkPlacement,
  styleFor,
  type GenerationContext
} from '../../context-blocks'
import { isCasualStyle } from '@/lib/formats'
import {
  CASUAL_TRUTH_RULES,
  casualPersona,
  casualStyleRules
} from '../shared/casual-rules'
import { TRUTH_RULES } from '../shared/truth-rules'
import type { DraftGenerationResult } from './schema'

/** The exemplars that teach rhythm better than any slider can. */
export function renderExemplars(ctx: GenerationContext): string {
  const exemplars = ctx.samplePosts
    .slice()
    .sort((a, b) => Number(b.performedWell) - Number(a.performedWell))
    .slice(0, 4)

  if (exemplars.length === 0) return ''

  return exemplars
    .map((s, i) => {
      const label = s.performedWell
        ? `Example ${i + 1} (performed well${s.engagementNote ? `: ${s.engagementNote}` : ''})`
        : `Example ${i + 1}`
      return `${label}:\n"""\n${s.content}\n"""`
    })
    .join('\n\n')
}

/**
 * Everything stable for this account and goal, in one block so it can be
 * cached. Every draft after the first in a run reads this prefix instead of
 * paying for it again.
 */
export function buildInstructions(ctx: GenerationContext): string {
  const goal = ctx.primaryGoal
  const exemplars = renderExemplars(ctx)
  const guardrails = renderGuardrailsBlock(ctx)
  const feedback = renderReviewerFeedbackBlock(ctx)
  const alsoSupports = renderAlsoSupportsBlock(ctx)
  // A casual or fun platform gets posts for followers; a professional one
  // the prompt it always had.
  const style = styleFor(ctx, platformOf(ctx).id)
  const casual = isCasualStyle(style) ? style : null

  return `${
    casual
      ? casualPersona(platformOf(ctx).name, casual)
      : `You are a ghostwriter producing a finished ${platformOf(ctx).name} post for one specific author. You write in their voice, not yours, and you never invent facts.`
  }

AUTHOR
${renderIdentityBlock(ctx)}

READER
${renderAudienceBlock(ctx)}

GOAL THIS POST SERVES
${renderGoalBlock(goal)}
${alsoSupports ? `\nIT ALSO SUPPORTS these goals: reinforce their messages where the argument meets them, with no second call to action or link:\n${alsoSupports}\n` : ''}
VOICE — match this precisely
${renderVoiceBlock(ctx)}

PLATFORM AND FORMAT RULES
${renderConstraintsBlock(ctx)}
${guardrails ? `\nGUARDRAILS\n${guardrails}` : ''}

TRUTH RULES
${casual ? CASUAL_TRUTH_RULES : TRUTH_RULES}

HOW IT SHOULD READ
${
  casual
    ? casualStyleRules(casual)
    : `- Open on one concrete thing: a specific moment, a figure from the evidence, or a claim a reader could disagree with. No throat-clearing, no "Ever wondered...", no definition of the topic.
- One idea per post, made through one specific example (a task, a decision, a scene), not a list of abstractions. If the idea asks for an example, include it.
- Vary sentence length. Use "it's not X, it's Y" at most twice in a post.
- Do not announce what the post is or is not ("this is not a pitch", "here's the thing", "let me be honest"). Show it.
- Do not summarise at the end. The last line before the call to action adds something new.
- Write the way this author would say it to one reader across a table, not the way a report is written.`
}
${feedback ? `\nREVIEWER FEEDBACK ON EARLIER POSTS — the author's own corrections; apply them\n${feedback}\n` : ''}${exemplars ? `\nHOW THIS AUTHOR ACTUALLY WRITES — match the rhythm, structure and idiom of these real posts:\n\n${exemplars}` : ''}`
}

/** The approved idea, its evidence, and exactly what to produce. */
/**
 * What a LinkedIn post that goes out as a carousel is told about its text:
 * it is the caption above the slides, which are designed separately. Only
 * added for a carousel, so every other LinkedIn prompt stays as it was.
 */
export const LINKEDIN_CAROUSEL_BLOCK = `THIS POST IS A CAROUSEL
It goes out with a document carousel: slides designed separately from this text, which LinkedIn shows page by page. The text you write is the caption above them. Open on the hook, give the context or story the slides do not, and say in one line what the slides walk through; you may invite the reader to click through them. Do not list every point the slides make, and do not number points.`

export function buildPrompt(
  ctx: GenerationContext,
  idea: Idea,
  /** 'carousel' for a post that goes out with slides; anything else changes nothing. */
  mediaFormat?: MediaFormat | null
): string {
  const constraints = ctx.prefs.constraints
  const goal = ctx.primaryGoal
  const linkPlacement = resolveLinkPlacement(goal)
  const goalLink = goal?.targetUrl || null

  const recentHooks = ctx.history.drafts
    .map(d => d.hook.trim())
    .filter(Boolean)
    .slice(0, 5)
  const recent =
    recentHooks.length > 0
      ? `\nThis author's latest posts opened with the lines below. Open differently, and do not reuse their phrasing or signature lines:\n${recentHooks.map(h => `- ${h}`).join('\n')}\n`
      : ''

  return `Write the post for this approved idea.
${recent}
Title: ${idea.title}
Thesis: ${idea.thesis || ''}
Angle: ${idea.angle || ''}
Why now: ${idea.whyNow || ''}
Hook concept (turn this into real copy, do not copy it verbatim): ${idea.hookConcept || idea.hook}
Core argument: ${idea.coreArgument || ''}
Reader takeaway: ${idea.audienceTakeaway || ''}

EVIDENCE YOU MAY USE (nothing outside this):
${
  (idea.supportingEvidence || []).length > 0
    ? (idea.supportingEvidence || [])
        .map(
          (e, i) =>
            `[${i + 1}] ${e.claim}${e.quote ? `\n    Quote: "${e.quote}"` : ''}${e.sourceTitle ? `\n    Source: ${e.sourceTitle}` : ''}${e.sourceUrl ? `\n    URL: ${e.sourceUrl}` : ''}`
        )
        .join('\n')
    : 'No external evidence was gathered. Write from reasoning alone and state no statistics.'
}

Produce:
1. hook — at most ${constraints.hook_max_chars} characters, a complete thought that survives the fold
2. body — the rest of the post after the hook; do not repeat the hook. Plain text; hook and body together about ${constraints.target_chars} characters${
    goalLink && linkPlacement === 'body'
      ? `; include this link once, near the call to action: ${goalLink}`
      : ''
  }
3. cta — ${describeCta(ctx)}
4. firstComment — ${
    linkPlacement === 'first_comment'
      ? `place any link here${goalLink ? ` (use ${goalLink})` : ''}`
      : 'optional supporting note'
  }
5. hashtags — ${describeHashtags(constraints)}, without the # symbol
6. alternateHooks — ${Math.max(2, Math.min(constraints.variants_per_post, 3))} genuinely different openings
7. selfScores — honest 1-10 ratings${mediaFormat === 'carousel' ? `\n\n${LINKEDIN_CAROUSEL_BLOCK}` : ''}`
}

/**
 * The same brief, plus the post as it stands and what the reviewer wants
 * changed. Without an instruction the reviewer just wants another take.
 */
export function buildRegeneratePrompt(
  ctx: GenerationContext,
  idea: Idea,
  current: { hook: string; body: string; cta?: string | null },
  instruction: string | null,
  mediaFormat?: MediaFormat | null
): string {
  return `${buildPrompt(ctx, idea, mediaFormat)}

The reviewer asked for a new version of this post.${
    instruction
      ? ' Keep what works and change what they ask for.'
      : ' Write a genuinely different take: a different opening and a different example, with the same argument and evidence.'
  }

CURRENT VERSION
Hook: ${current.hook}
Body:
${current.body}
CTA: ${current.cta || ''}${
    instruction
      ? `

WHAT THE REVIEWER WANTS CHANGED — follow it, within the truth rules:
${instruction}`
      : ''
  }`
}

/** The same brief, plus the previous draft and the checks it failed. */
export function buildRevisionPrompt(
  ctx: GenerationContext,
  idea: Idea,
  previous: DraftGenerationResult,
  failedChecks: string[],
  mediaFormat?: MediaFormat | null
): string {
  return `${buildPrompt(ctx, idea, mediaFormat)}

Your previous draft failed these checks. Rewrite it so every one passes, keeping the argument and the voice intact.

PREVIOUS DRAFT
Hook: ${previous.hook}
Body:
${previous.body}
CTA: ${previous.cta}

FAILED CHECKS
${failedChecks.map(m => `- ${m}`).join('\n')}`
}
