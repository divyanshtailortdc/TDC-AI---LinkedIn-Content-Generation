import 'server-only'

import { runSkill, SkillError } from '../../run-skill'
import { addUsage, EMPTY_USAGE, type CallUsage } from '../../usage'
import { buildPrompt, INSTRUCTIONS } from './prompt'
import {
  LookSeriesSchema,
  type DesignLookSeriesInput,
  type DesignLookSeriesResult,
  type LookSeries
} from './schema'

export type * from './schema'

/** A design call still running after this leaves the carousel drawn in the brand. */
const LOOK_SERIES_TIMEOUT_MS = 120_000

/**
 * The design as it may be used: example numbers that exist (1 to 3, none
 * twice) and one entry per slide, a missing one left with an empty scene
 * (the slide writer's picture idea stands in). Null without a design to
 * follow.
 */
export function cleanLookSeries(
  series: LookSeries,
  exampleCount: number,
  slideCount: number
): LookSeries | null {
  const examples = [...new Set(series.examples)]
    .filter(n => Number.isInteger(n) && n >= 1 && n <= exampleCount)
    .slice(0, 3)
  if (examples.length === 0 && exampleCount > 0) examples.push(1)
  if (!series.styleNotes.trim() || examples.length === 0) return null
  const slides = Array.from({ length: slideCount }, (_, i) => ({
    scene: series.slides[i]?.scene?.replace(/\s+/g, ' ').trim() ?? '',
    concept: series.slides[i]?.concept?.replace(/\s+/g, ' ').trim() ?? ''
  }))
  return { ...series, styleNotes: series.styleNotes.trim(), examples, slides }
}

/**
 * Skill: a carousel's slides and the account's example images in, one
 * design for all of them out (which examples to follow, the style, where
 * the logo sits, what each slide shows beside its words). Never throws: a
 * failure comes back with its reason.
 */
export async function designLookSeries(
  input: DesignLookSeriesInput,
  options: { abortSignal?: AbortSignal } = {}
): Promise<DesignLookSeriesResult> {
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
      schema: LookSeriesSchema,
      timeoutMs: LOOK_SERIES_TIMEOUT_MS,
      maxRetries: 1,
      abortSignal: options.abortSignal
    })
    usage = addUsage(usage, result.usage)
    const series = cleanLookSeries(
      result.output,
      input.examples.length,
      input.slides.length
    )
    return series
      ? { series, usage }
      : {
          series: null,
          error: 'The slides could not be designed from the examples.',
          usage
        }
  } catch (err) {
    if (err instanceof SkillError) usage = addUsage(usage, err.usage)
    return {
      series: null,
      error:
        err instanceof Error ? err.message : 'The slides could not be designed.',
      usage
    }
  }
}
