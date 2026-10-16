import 'server-only'

import type { Idea } from '@/db/schema'
import type { GenerationContext } from '../../context'
import { runSkill, SkillError } from '../../run-skill'
import type { CallUsage } from '../../usage'
import { isCompleteDraft, withoutRepeatedHook } from './guard'
import { buildInstructions, buildPrompt, buildRevisionPrompt } from './prompt'
import { DraftGenerationSchema, type DraftGenerationResult } from './schema'

export type { DraftGenerationResult } from './schema'

/**
 * Skill: an approved idea plus the account's settings in; a finished post
 * (hook, body, CTA, first comment, hashtags, alternate hooks, self-scores) out.
 *
 * Pass `revise` for the single revision pass: the previous draft and the
 * linter messages it failed. Throws SkillError on failure or an incomplete
 * draft; its usage is what that attempt cost.
 */
export async function writeDraft(
  input: { ctx: GenerationContext; idea: Idea },
  revise?: { previous: DraftGenerationResult; failedChecks: string[] }
): Promise<{
  draft: DraftGenerationResult
  usage: CallUsage
  modelId: string
}> {
  const { output, usage, modelId } = await runSkill({
    stage: 'drafting',
    instructions: buildInstructions(input.ctx),
    // Identical for every draft in a run, so later drafts read it from cache.
    cacheInstructions: true,
    prompt: revise
      ? buildRevisionPrompt(
          input.ctx,
          input.idea,
          revise.previous,
          revise.failedChecks
        )
      : buildPrompt(input.ctx, input.idea),
    schema: DraftGenerationSchema
  })

  if (!isCompleteDraft(output)) {
    throw new SkillError('The model returned an incomplete draft.', 'failed', {
      usage
    })
  }
  return { draft: withoutRepeatedHook(output), usage, modelId }
}
