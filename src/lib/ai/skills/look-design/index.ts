import 'server-only'

import { runSkill, SkillError } from '../../run-skill'
import { addUsage, EMPTY_USAGE, type CallUsage } from '../../usage'
import { buildPrompt, INSTRUCTIONS } from './prompt'
import {
  LOOK_MAX_WORDS,
  LookDesignSchema,
  type DesignLookInput,
  type DesignLookResult,
  type LookDesign
} from './schema'

export type * from './schema'

/** A design call still running after this fails the image instead of holding the post. */
const LOOK_DESIGN_TIMEOUT_MS = 90_000

const wordCount = (design: LookDesign) =>
  design.text.reduce(
    (n, t) => n + t.text.trim().split(/\s+/).filter(Boolean).length,
    0
  )

/**
 * The design as it may be used: example numbers that exist (1 to 3, none
 * twice), text parts that say something, within the word limit (parts
 * are dropped from the end when over it, so the title stays). Null when
 * nothing usable is left.
 */
export function cleanLookDesign(
  design: LookDesign,
  exampleCount: number
): LookDesign | null {
  const examples = [...new Set(design.examples)]
    .filter(n => Number.isInteger(n) && n >= 1 && n <= exampleCount)
    .slice(0, 3)
  if (examples.length === 0 && exampleCount > 0) examples.push(1)
  const text = design.text
    .map(t => ({
      part: t.part.trim(),
      text: t.text.replace(/\s+/g, ' ').trim()
    }))
    .filter(t => t.text)
  let cleaned: LookDesign = { ...design, examples, text }
  while (wordCount(cleaned) > LOOK_MAX_WORDS && cleaned.text.length > 1) {
    cleaned = { ...cleaned, text: cleaned.text.slice(0, -1) }
  }
  if (!cleaned.scene.trim() || examples.length === 0) return null
  return cleaned
}

/**
 * Skill: a post and the account's example images in, the design of a new
 * image made like them out (which examples to follow, the scene, the exact
 * words). Never throws: a failure comes back with its reason.
 */
export async function designLook(
  input: DesignLookInput,
  options: { abortSignal?: AbortSignal } = {}
): Promise<DesignLookResult> {
  let usage: CallUsage = EMPTY_USAGE
  try {
    const result = await runSkill({
      stage: 'media_brief',
      instructions: INSTRUCTIONS,
      prompt: buildPrompt(input),
      images: input.examples.map(e => ({
        data: e.data,
        mediaType: e.mediaType
      })),
      schema: LookDesignSchema,
      timeoutMs: LOOK_DESIGN_TIMEOUT_MS,
      maxRetries: 1,
      abortSignal: options.abortSignal
    })
    usage = addUsage(usage, result.usage)
    const design = cleanLookDesign(result.output, input.examples.length)
    return design
      ? { design, usage }
      : {
          design: null,
          error: 'The image could not be designed from the examples.',
          usage
        }
  } catch (err) {
    if (err instanceof SkillError) usage = addUsage(usage, err.usage)
    return {
      design: null,
      error:
        err instanceof Error ? err.message : 'The image could not be designed.',
      usage
    }
  }
}
