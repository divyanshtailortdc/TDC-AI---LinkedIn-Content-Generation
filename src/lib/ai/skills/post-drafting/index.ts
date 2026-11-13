import 'server-only'

import type { Idea } from '@/db/schema'
import type { MediaFormat } from '@/lib/formats/types'
import type { GenerationContext } from '../../context'
import { runSkill, SkillError } from '../../run-skill'
import type { CallUsage } from '../../usage'
import { isCompleteDraft, withoutRepeatedHook } from './guard'
import {
  buildInstructions,
  buildPrompt,
  buildRegeneratePrompt,
  buildRevisionPrompt
} from './prompt'
import { DraftGenerationSchema, type DraftGenerationResult } from './schema'

export type { DraftGenerationResult } from './schema'

/** What a regenerate starts from: the post as it stands, and what to change. */
export interface RegenerateRequest {
  current: {
    hook: string
    body: string
    cta?: string | null
    /** A video's shots and caption, so its new version is written from them. */
    payload?: Record<string, unknown> | null
  }
  /** The reviewer's words; null for "just another take". */
  instruction: string | null
}

/**
 * A bound on one drafting call, retries included, so a call that never
 * answers fails that idea instead of holding a drafting slot. Many times
 * what a draft takes (about 10s).
 */
const DRAFTING_TIMEOUT_MS = 120_000

/**
 * Skill: an approved idea plus the account's settings in; a finished post
 * (hook, body, CTA, first comment, hashtags, alternate hooks, self-scores) out.
 *
 * Pass `revise` for the single revision pass: the previous draft and the
 * linter messages it failed. Throws SkillError on failure or an incomplete
 * draft; its usage is what that attempt cost.
 */
export async function writeDraft(
  input: {
    ctx: GenerationContext
    idea: Idea
    /** What goes out with the text; a carousel's caption is written as one. */
    mediaFormat?: MediaFormat | null
  },
  revise?: { previous: DraftGenerationResult; failedChecks: string[] },
  /** A new version of an existing post, with what the reviewer wants changed. */
  regenerate?: RegenerateRequest
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
          revise.failedChecks,
          input.mediaFormat
        )
      : regenerate
        ? buildRegeneratePrompt(
            input.ctx,
            input.idea,
            regenerate.current,
            regenerate.instruction,
            input.mediaFormat
          )
        : buildPrompt(input.ctx, input.idea, input.mediaFormat),
    schema: DraftGenerationSchema,
    timeoutMs: DRAFTING_TIMEOUT_MS,
    maxRetries: 1
  })

  if (!isCompleteDraft(output)) {
    throw new SkillError('The model returned an incomplete draft.', 'failed', {
      usage
    })
  }
  return { draft: withoutRepeatedHook(output), usage, modelId }
}
