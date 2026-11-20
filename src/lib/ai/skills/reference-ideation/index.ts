import 'server-only'

import type { GenerationContext } from '../../context-blocks'
import { runSkill } from '../../run-skill'
import type { PlatformId } from '@/lib/formats'
import type { ReferencePost } from '@/lib/reference-post/types'
import { cleanReferenceIdea, type ReferenceIdea } from './guard'
import { buildPrompt, INSTRUCTIONS } from './prompt'
import { ReferenceIdeaSchema } from './schema'

export type { ReferenceIdea } from './guard'

/** The user waits on the dialog; past this, trying again beats waiting. */
const MODEL_TIMEOUT_MS = 90_000

/**
 * Skill: a post someone shared (and its picture, when one could be fetched)
 * in, an idea for a post like it by this author out. Throws SkillError when
 * the model cannot be reached, EmptyReferenceIdeaError when its answer has
 * nothing to write from.
 */
export async function ideaFromReferencePost(input: {
  ctx: GenerationContext
  reference: ReferencePost
  platforms: PlatformId[]
  carouselPossible: boolean
  image?: { data: Uint8Array; mediaType: string } | null
}): Promise<ReferenceIdea> {
  const { output } = await runSkill({
    stage: 'reference_ideation',
    instructions: INSTRUCTIONS,
    prompt: buildPrompt(input),
    ...(input.image ? { images: [input.image] } : {}),
    schema: ReferenceIdeaSchema,
    timeoutMs: MODEL_TIMEOUT_MS,
    maxRetries: 1
  })
  return cleanReferenceIdea(output, {
    reference: input.reference,
    goals: input.ctx.selectedGoals,
    carouselPossible: input.carouselPossible
  })
}
