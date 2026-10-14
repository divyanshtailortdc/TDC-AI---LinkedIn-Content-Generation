import {
  renderAudienceBlock,
  renderGoalBlock,
  renderGuardrailsBlock,
  renderIdentityBlock,
  renderVoiceBlock,
  type GenerationContext
} from '../../context'
import type { GroundingCorpus } from './guard'
import { PERSPECTIVE_ANGLE_GUIDE } from './schema'

/**
 * How many evidence items the ideation prompt shows. Citations are resolved
 * against exactly this slice, so an out-of-range label gets no source.
 */
export const PROMPT_EVIDENCE_LIMIT = 30

export function renderCorpusForPrompt(
  corpus: GroundingCorpus,
  limit: number
): string {
  if (corpus.verifiedClaims.length === 0) {
    return 'No evidence was gathered for this run. Do NOT state any statistic, metric or named example. Build ideas from reasoning the author can defend from their own stated expertise.'
  }
  return corpus.verifiedClaims
    .slice(0, limit)
    .map((c, i) => {
      const parts = [`[E${i + 1}] ${c.claim}`]
      if (c.quote && c.quote !== c.claim) parts.push(`    Quote: "${c.quote}"`)
      if (c.sourceTitle) parts.push(`    Source: ${c.sourceTitle}`)
      if (c.sourceUrl) parts.push(`    URL: ${c.sourceUrl}`)
      return parts.join('\n')
    })
    .join('\n')
}

/** Who the ideas are for and the rules they must follow; the same all run. */
export function buildInstructions(ctx: GenerationContext): string {
  const pillarBrief =
    ctx.prefs.pillars.length > 0
      ? ctx.prefs.pillars
          .map(
            p =>
              `- ${p.name} (${p.weight_pct}% of output)${
                (p.example_topics || []).length > 0
                  ? `\n    Example topics: ${(p.example_topics || []).join(', ')}`
                  : ''
              }`
          )
          .join('\n')
      : 'No pillars configured — infer sensible themes from the identity and goal.'

  const guardrails = renderGuardrailsBlock(ctx)

  return `You are a senior editorial strategist who plans LinkedIn content for one specific person or company.

Everything you propose must be true of THIS account and defensible from THIS evidence. You are not writing generic B2B advice, and you have no knowledge of this business beyond what appears below.

WHO YOU ARE WRITING FOR
${renderIdentityBlock(ctx)}

WHO IS READING
${renderAudienceBlock(ctx)}

THE GOAL THIS RUN SERVES
${renderGoalBlock(ctx.primaryGoal)}

HOW THIS AUTHOR SOUNDS
${renderVoiceBlock(ctx)}

CONTENT PILLARS
${pillarBrief}
${guardrails ? `\nGUARDRAILS\n${guardrails}` : ''}

RULES THAT OVERRIDE EVERYTHING ELSE
1. Never state a statistic, metric, dollar figure or named customer unless it appears verbatim in the evidence below. If you have no number, make the point without one.
2. Never invent first-hand experience. Do not write "we discovered", "I spoke to a customer", "last week we saw". You do not know what this person did.
3. Only claim something is timely if the evidence carries a recent date. Otherwise argue from structure, not from news.
4. Do not pitch the account's product. These are ideas that stand on their own; the offering is context for credibility, not the conclusion.
5. Qualify honestly. Prefer "often", "in most teams" over "always", "every", "proves that".`
}

/** This run's evidence, history and the exact ideas to produce. */
export function buildPrompt(input: {
  corpus: GroundingCorpus
  /** Recent hooks this account already published. */
  recentHooks: string[]
  candidateCount: number
  /** One pillar name per idea, in order. */
  assignedPillars: string[]
  hookMaxChars: number
}): string {
  const { corpus, candidateCount } = input
  const anglesList = Object.entries(PERSPECTIVE_ANGLE_GUIDE)
    .map(([angle, guide]) => `- ${angle}: ${guide}`)
    .join('\n')

  const recentHooks = input.recentHooks.map(h => `- ${h}`).join('\n')

  return `EVIDENCE AVAILABLE THIS RUN
${renderCorpusForPrompt(corpus, PROMPT_EVIDENCE_LIMIT)}

${
  recentHooks
    ? `ALREADY PUBLISHED BY THIS ACCOUNT — do not repeat these angles:\n${recentHooks}\n`
    : ''
}
ANALYTICAL LENSES — give each idea a different one:
${anglesList}

Produce exactly ${candidateCount} distinct post ideas.

Assign pillars in this distribution (one per idea, in order): ${input.assignedPillars.join(' | ') || 'your own judgement'}

For each idea provide:
- title: a specific, non-generic working title
- thesis: the defensible proposition in one or two sentences
- perspectiveAngle: the lens from the list above (each idea must use a different one)
- angle: the distinctive point of view in a phrase
- pillar: the assigned pillar
- format: the post format that fits best
- whyNow: why this earns feed space today; use structural reasoning unless dated evidence supports timeliness
- hookConcept: the idea for the first ${input.hookMaxChars} characters, before the fold. A concept, not final copy.
- coreArgument: the "so what", in full
- audienceTakeaway: what the reader does or believes differently afterwards
- supportingEvidence: claims traceable to the evidence above. Cite each by its label (evidenceRef "E3") with the claim as it applies here. Do not retype URLs, titles or quotes. Leave empty rather than inventing.
- mediaBrief: one sentence of visual direction for the image
- noveltyNote: why this is not the generic take on the subject
- risks: anything that could make this land badly
- estimatedStrength: your honest 1-100 assessment`
}
