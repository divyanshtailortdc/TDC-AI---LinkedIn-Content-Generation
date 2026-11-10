import 'server-only'

import { audienceSegments, type GenerationContext } from '../../context'
import { inferRegion } from '../../region'
import { runSkill } from '../../run-skill'
import type { CallUsage } from '../../usage'
import {
  resolveGeneratedIdea,
  validateIdea,
  type GroundingCorpus
} from './guard'
import {
  buildInstructions,
  buildPrompt,
  PROMPT_EVIDENCE_LIMIT,
  type IdeationChannels
} from './prompt'
import {
  IdeaGenerationBatchSchema,
  IdeaGenerationWithFormatsBatchSchema,
  type GeneratedIdeaItem
} from './schema'
import { cleanFormats } from '@/lib/formats'

export type { GroundingCorpus } from './guard'
export { ideationChannels, type IdeationChannels } from './prompt'
export type { GeneratedIdeaItem } from './schema'

/**
 * A bound on one ideation call, retries included, so a call that never
 * answers fails the run instead of holding the worker (one run at a time).
 * Several times what a call takes (about 45s); the run's own deadline is in
 * ideation-run.
 */
const IDEATION_TIMEOUT_MS = 180_000

/**
 * Skill: the account's settings plus this run's evidence in; post ideas out,
 * each with its evidence resolved from the corpus and checked for grounding.
 *
 * Throws SkillError when the model call fails; the pipeline records that.
 */
export async function generateIdeas(input: {
  ctx: GenerationContext
  corpus: GroundingCorpus
  /** Earlier work and the reviewer's verdicts, already rendered. */
  history: string
  candidateCount: number
  /** One goal label per candidate, in order (see spreadGoals). */
  assignedGoals: string[]
  /** The run's deadline. */
  abortSignal?: AbortSignal
  /** The platforms the run plans for; null for LinkedIn alone. */
  channels?: IdeationChannels | null
}): Promise<{
  /** Everything the model proposed, before the grounding check. */
  candidates: GeneratedIdeaItem[]
  /** Ideas that passed the grounding check, scored. */
  valid: GeneratedIdeaItem[]
  /** With the goal each was written for, so an uncovered goal can be explained. */
  discarded: Array<{ title: string; reason: string; goalId?: string }>
  usage: CallUsage
  modelId: string
}> {
  const channels = input.channels ?? null
  const { output, usage, modelId } = await runSkill({
    stage: 'ideation',
    instructions: buildInstructions(input.ctx, channels),
    prompt: buildPrompt({
      corpus: input.corpus,
      history: input.history,
      candidateCount: input.candidateCount,
      assignedGoals: input.assignedGoals,
      hookMaxChars: input.ctx.prefs.constraints.hook_max_chars,
      channels
    }),
    // A run with one format asks for exactly what it always did.
    schema: channels
      ? IdeaGenerationWithFormatsBatchSchema
      : IdeaGenerationBatchSchema,
    timeoutMs: IDEATION_TIMEOUT_MS,
    maxRetries: 1,
    abortSignal: input.abortSignal
  })

  // Citations, reader groups and goals are resolved against exactly what the
  // prompt showed.
  const shownEvidence = input.corpus.verifiedClaims.slice(
    0,
    PROMPT_EVIDENCE_LIMIT
  )
  const audiences = audienceSegments(input.ctx).map(s => s.label)
  const goals = input.ctx.selectedGoals.map(g => g.id)
  const candidates = (output?.ideas || []).map(generated => {
    const idea = resolveGeneratedIdea(generated, shownEvidence, audiences, goals)
    if (!channels) return idea
    // Only formats this run offered, so an invented id is dropped.
    const named = cleanFormats((generated as { formats?: unknown }).formats)
    return { ...idea, formatFit: named.filter(f => channels.formats.includes(f)) }
  })

  const fit = {
    goals,
    audiences,
    region: inferRegion(input.ctx)
  }
  const valid: GeneratedIdeaItem[] = []
  const discarded: Array<{ title: string; reason: string; goalId?: string }> =
    []
  for (const candidate of candidates) {
    const result = validateIdea(candidate, input.corpus, fit)
    if (!result.isValid) {
      discarded.push({
        title: candidate.title,
        goalId: candidate.goalId,
        reason:
          result.rejectionReason || result.issues[0] || 'Failed grounding checks'
      })
      continue
    }
    valid.push(result.idea)
  }

  return { candidates, valid, discarded, usage, modelId }
}
