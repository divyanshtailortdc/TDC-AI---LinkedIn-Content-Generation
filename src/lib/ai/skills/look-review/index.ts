import 'server-only'

import { runSkill, SkillError } from '../../run-skill'
import { EMPTY_USAGE } from '../../usage'
import { buildPrompt, INSTRUCTIONS } from './prompt'
import {
  LookReviewSchema,
  type ReviewLookInput,
  type ReviewLookResult
} from './schema'

export { lookIssues, lookRetryLines } from './prompt'
export type * from './schema'

/** A review that takes longer than this is skipped, not waited on. */
const REVIEW_TIMEOUT_MS = 60_000

/**
 * Skill: an image made like the account's example posts, with the examples,
 * in; what is wrong with it out. A failed review never blocks the image: it
 * comes back unchecked.
 */
export async function reviewLook(
  input: ReviewLookInput
): Promise<ReviewLookResult> {
  try {
    const result = await runSkill({
      stage: 'media_review',
      instructions: INSTRUCTIONS,
      prompt: buildPrompt({ ...input, exampleCount: input.examples.length }),
      images: [
        { data: input.image, mediaType: input.mediaType },
        ...input.examples
      ],
      schema: LookReviewSchema,
      timeoutMs: REVIEW_TIMEOUT_MS,
      maxRetries: 1,
      abortSignal: input.abortSignal
    })
    return { review: result.output, usage: result.usage }
  } catch (err) {
    const usage = err instanceof SkillError ? err.usage : EMPTY_USAGE
    if (!input.abortSignal?.aborted) {
      console.warn('The image check failed; keeping the image unchecked:', err)
    }
    return {
      review: null,
      error: err instanceof Error ? err.message : 'The image check failed.',
      usage
    }
  }
}
