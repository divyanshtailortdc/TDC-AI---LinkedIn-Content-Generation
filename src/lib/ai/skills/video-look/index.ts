import 'server-only'

import { cleanVideoLook, type VideoLook } from '@/lib/video/render/look'
import { runSkill } from '../../run-skill'
import { buildPrompt, INSTRUCTIONS } from './prompt'
import { VideoLookSchema, type DesignVideoLookInput } from './schema'

export type * from './schema'

/** A look still being chosen after this is given up; the video keeps its default. */
const LOOK_TIMEOUT_MS = 90_000

/**
 * Skill: what is known about how an account posts, and a few of its post
 * images, in; the look of its next Reel or Short out. Throws SkillError when
 * the model cannot be reached or a spending limit is reached.
 */
export async function designVideoLook(input: DesignVideoLookInput): Promise<{
  look: VideoLook
  modelUsed: string
}> {
  const result = await runSkill({
    stage: 'video_look',
    instructions: INSTRUCTIONS,
    prompt: buildPrompt(input),
    images: input.images.map(i => ({ data: i.data, mediaType: i.mediaType })),
    schema: VideoLookSchema,
    timeoutMs: LOOK_TIMEOUT_MS,
    maxRetries: 1,
    abortSignal: input.abortSignal
  })
  return {
    look: cleanVideoLook(result.output, input.images.length),
    modelUsed: `${result.providerName} (${result.modelId})`
  }
}
