import 'server-only'

import type { Idea } from '@/db/schema'
import { FORMATS, type FormatId } from '@/lib/formats'
import type { GenerationContext } from '../../context'
import { runSkill, SkillError } from '../../run-skill'
import type { CallUsage } from '../../usage'
import { withoutRepeatedHook } from '../post-drafting/guard'
import {
  buildFormatPrompt,
  buildIdeaBlock,
  buildRegeneratePrompt,
  buildRevisionPrompt,
  buildSharedInstructions,
  styleOfFormat,
  type ApprovedSibling
} from './prompt'
import type { RegenerateRequest } from '../post-drafting'
import { toVariantDraft, VariantOutputSchema, type VariantDraft } from './schema'

export type { ApprovedSibling } from './prompt'

export type { VariantDraft } from './schema'

/** As for LinkedIn drafting: a bound on one call, retries included. */
const DRAFTING_TIMEOUT_MS = 120_000

/** A post with nothing to open on, or a thread too short to be one, is unusable. */
export function isCompleteVariant(formatId: FormatId, draft: VariantDraft): boolean {
  if (!draft.hook.trim()) return false
  const spec = FORMATS[formatId]
  if (spec.structure === 'single') return true
  // A thread's other posts, or a video's other shots, sit in the body; it
  // needs at least one.
  return Boolean(draft.body.trim())
}

/**
 * Skill: an approved idea, the account's settings and a format in; a finished
 * post in that format out. Every format of one idea in the same style shares
 * the first two instruction blocks, so the second and later formats read them
 * from cache.
 *
 * Pass `revise` for the single revision pass. Throws SkillError on failure or
 * an incomplete post; its usage is what that attempt cost.
 */
export async function writeVariant(
  input: {
    ctx: GenerationContext
    idea: Idea
    formatId: FormatId
    /** How this idea's posts on other platforms already open. */
    siblingOpenings?: string[]
    /** This idea's posts the reviewer approved on other platforms. */
    approvedSiblings?: ApprovedSibling[]
  },
  revise?: { previous: VariantDraft; failedChecks: string[] },
  /** A new version of an existing post, with what the reviewer wants changed. */
  regenerate?: RegenerateRequest
): Promise<{ draft: VariantDraft; usage: CallUsage; modelId: string }> {
  const { ctx, idea, formatId } = input
  const siblings = input.siblingOpenings ?? []
  const approved = input.approvedSiblings ?? []
  const { output, usage, modelId } = await runSkill({
    stage: 'drafting',
    // Formats in the same style share this block and its cache entry.
    instructions: [
      buildSharedInstructions(ctx, styleOfFormat(ctx, formatId)),
      buildIdeaBlock(idea)
    ],
    cacheInstructions: true,
    prompt: revise
      ? buildRevisionPrompt(
          ctx,
          formatId,
          revise.previous,
          revise.failedChecks,
          siblings,
          approved
        )
      : regenerate
        ? buildRegeneratePrompt(
            ctx,
            formatId,
            regenerate.current,
            regenerate.instruction,
            siblings,
            approved
          )
        : buildFormatPrompt(ctx, formatId, siblings, approved),
    // One schema for every format, so they share the prompt cache.
    schema: VariantOutputSchema,
    timeoutMs: DRAFTING_TIMEOUT_MS,
    maxRetries: 1
  })

  const draft = toVariantDraft(formatId, output)
  if (!isCompleteVariant(formatId, draft)) {
    throw new SkillError(
      `The model returned an incomplete ${FORMATS[formatId].label}.`,
      'failed',
      { usage }
    )
  }
  const cleaned =
    FORMATS[formatId].structure === 'single' ? withoutRepeatedHook(draft) : draft
  return { draft: cleaned, usage, modelId }
}
