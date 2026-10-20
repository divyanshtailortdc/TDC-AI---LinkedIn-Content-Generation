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
import { buildInstructions, buildPrompt, PROMPT_EVIDENCE_LIMIT } from './prompt'
import { IdeaGenerationBatchSchema, type GeneratedIdeaItem } from './schema'

export type { GroundingCorpus } from './guard'
export type { GeneratedIdeaItem } from './schema'

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
  assignedPillars: string[]
}): Promise<{
  /** Everything the model proposed, before the grounding check. */
  candidates: GeneratedIdeaItem[]
  /** Ideas that passed the grounding check, scored. */
  valid: GeneratedIdeaItem[]
  discarded: Array<{ title: string; reason: string }>
  usage: CallUsage
  modelId: string
}> {
  const { output, usage, modelId } = await runSkill({
    stage: 'ideation',
    instructions: buildInstructions(input.ctx),
    prompt: buildPrompt({
      corpus: input.corpus,
      history: input.history,
      candidateCount: input.candidateCount,
      assignedPillars: input.assignedPillars,
      hookMaxChars: input.ctx.prefs.constraints.hook_max_chars
    }),
    schema: IdeaGenerationBatchSchema
  })

  // Citations and reader groups are resolved against exactly what the prompt showed.
  const shownEvidence = input.corpus.verifiedClaims.slice(
    0,
    PROMPT_EVIDENCE_LIMIT
  )
  const audiences = audienceSegments(input.ctx).map(s => s.label)
  const candidates = (output?.ideas || []).map(generated =>
    resolveGeneratedIdea(generated, shownEvidence, audiences)
  )

  const fit = {
    pillars: input.ctx.prefs.pillars.map(p => p.name),
    audiences,
    region: inferRegion(input.ctx)
  }
  const valid: GeneratedIdeaItem[] = []
  const discarded: Array<{ title: string; reason: string }> = []
  for (const candidate of candidates) {
    const result = validateIdea(candidate, input.corpus, fit)
    if (!result.isValid) {
      discarded.push({
        title: candidate.title,
        reason:
          result.rejectionReason || result.issues[0] || 'Failed grounding checks'
      })
      continue
    }
    valid.push(result.idea)
  }

  return { candidates, valid, discarded, usage, modelId }
}
