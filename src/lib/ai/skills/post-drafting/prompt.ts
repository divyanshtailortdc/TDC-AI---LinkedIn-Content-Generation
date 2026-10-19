import type { Idea } from '@/db/schema'
import {
  describeCta,
  describeHashtags,
  renderAudienceBlock,
  renderConstraintsBlock,
  renderGoalBlock,
  renderGuardrailsBlock,
  renderIdentityBlock,
  renderReviewerFeedbackBlock,
  renderVoiceBlock,
  resolveLinkPlacement,
  type GenerationContext
} from '../../context-blocks'
import type { DraftGenerationResult } from './schema'

/** The exemplars that teach rhythm better than any slider can. */
function renderExemplars(ctx: GenerationContext): string {
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

  return `You are a ghostwriter producing a finished LinkedIn post for one specific author. You write in their voice, not yours, and you never invent facts.

AUTHOR
${renderIdentityBlock(ctx)}

READER
${renderAudienceBlock(ctx)}

GOAL THIS POST SERVES
${renderGoalBlock(goal)}

VOICE — match this precisely
${renderVoiceBlock(ctx)}

PLATFORM AND FORMAT RULES
${renderConstraintsBlock(ctx)}
${guardrails ? `\nGUARDRAILS\n${guardrails}` : ''}

TRUTH RULES
- Use only the evidence supplied with the idea and the author's own details above. If a number is not in either, do not write a number.
- Never claim first-hand experience ("I keep seeing", "clients tell me", "in my experience") unless the evidence or the author's details above state it.
- Evidence from a web page is someone else's work. When you rely on it, name its source by title, put it in your own words (never lift a sentence), and never write "one recent post", "studies show" or "experts say".
- Write "most", "everyone", "always" or "never" only when the evidence measures it. Otherwise use "many", "often" or "in some teams".
- Write plain text. Real line breaks, no markdown of any kind.

HOW IT SHOULD READ
- Open on one concrete thing: a specific moment, a figure from the evidence, or a claim a reader could disagree with. No throat-clearing, no "Ever wondered...", no definition of the topic.
- One idea per post, made through one specific example (a task, a decision, a scene), not a list of abstractions. If the idea asks for an example, include it.
- Vary sentence length. Use "it's not X, it's Y" at most twice in a post.
- Do not announce what the post is or is not ("this is not a pitch", "here's the thing", "let me be honest"). Show it.
- Do not summarise at the end. The last line before the call to action adds something new.
- Write the way this author would say it to one reader across a table, not the way a report is written.
${feedback ? `\nREVIEWER FEEDBACK ON EARLIER POSTS — the author's own corrections; apply them\n${feedback}\n` : ''}${exemplars ? `\nHOW THIS AUTHOR ACTUALLY WRITES — match the rhythm, structure and idiom of these real posts:\n\n${exemplars}` : ''}`
}

/** The approved idea, its evidence, and exactly what to produce. */
export function buildPrompt(ctx: GenerationContext, idea: Idea): string {
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
7. selfScores — honest 1-10 ratings`
}

/** The same brief, plus the previous draft and the checks it failed. */
export function buildRevisionPrompt(
  ctx: GenerationContext,
  idea: Idea,
  previous: DraftGenerationResult,
  failedChecks: string[]
): string {
  return `${buildPrompt(ctx, idea)}

Your previous draft failed these checks. Rewrite it so every one passes, keeping the argument and the voice intact.

PREVIOUS DRAFT
Hook: ${previous.hook}
Body:
${previous.body}
CTA: ${previous.cta}

FAILED CHECKS
${failedChecks.map(m => `- ${m}`).join('\n')}`
}
