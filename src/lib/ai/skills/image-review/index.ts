import 'server-only'

import { runSkill, SkillError } from '../../run-skill'
import { EMPTY_USAGE } from '../../usage'
import { judgeImageReview } from './guard'
import { buildPrompt, INSTRUCTIONS } from './prompt'
import {
  ImageReviewSchema,
  type ReviewImageInput,
  type ReviewImageResult
} from './schema'

export type * from './schema'

/** A review that takes longer than this is skipped, not waited on. */
const REVIEW_TIMEOUT_MS = 60_000

/**
 * Skill: a generated image in, a list of what is wrong with it out.
 *
 * Image models misspell anything smaller than a headline, invent lettering on
 * screens and signs, and sometimes draw a logo of their own. A text check of
 * the prompt cannot see any of that, so a vision model looks at the result.
 * A failed review never blocks the image: it comes back unchecked.
 */
export async function reviewImage(
  input: ReviewImageInput
): Promise<ReviewImageResult> {
  try {
    const result = await runSkill({
      stage: 'media_review',
      instructions: INSTRUCTIONS,
      prompt: buildPrompt(input),
      // The image under review first; the reference, when there is one, second.
      images: [
        { data: input.image, mediaType: input.mediaType },
        ...(input.reference ? [input.reference] : [])
      ],
      schema: ImageReviewSchema,
      timeoutMs: REVIEW_TIMEOUT_MS,
      maxRetries: 1,
      abortSignal: input.abortSignal
    })
    return {
      review: result.output,
      verdict: judgeImageReview(result.output, {
        headline: input.headline,
        brandGiven: Boolean(input.brand?.trim()),
        referenceGiven: Boolean(input.reference)
      }),
      usage: result.usage
    }
  } catch (err) {
    const usage = err instanceof SkillError ? err.usage : EMPTY_USAGE
    if (
      !input.abortSignal?.aborted &&
      !(err instanceof SkillError && err.reason === 'not_configured')
    ) {
      console.warn('Image review failed; keeping the image unchecked:', err)
    }
    return {
      review: null,
      verdict: null,
      error: err instanceof Error ? err.message : 'The image review failed.',
      usage
    }
  }
}
