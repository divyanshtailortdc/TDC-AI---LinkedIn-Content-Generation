import { z } from 'zod'
import type { CallUsage } from '../../usage'

/**
 * The check on an image made like the account's example posts: are the
 * words the ones asked for, spelled right, with nothing added; does it
 * invent facts, draw other brands' marks or copy the examples' content; does
 * it look generated; and does it look like it belongs with the examples.
 */
export const LookReviewSchema = z.object({
  visibleText: z
    .array(z.string())
    .describe(
      'Every piece of lettering visible in the first image, transcribed exactly as drawn, misspellings and gibberish included.'
    ),
  textErrors: z
    .array(z.string())
    .describe(
      'Each intended text part that is missing, misspelled, cut off or worded differently, saying what is wrong, e.g. \'title reads "Recods" instead of "Records"\'. Letter case, line breaks and type styling (all caps, bold, italics) are design choices, not errors. Empty when every part is right.'
    ),
  extraText: z
    .array(z.string())
    .describe(
      'Lettering that is not one of the intended parts, including pseudo-words on screens, papers, signs, labels or packaging. Not the brand logo laid on by code.'
    ),
  extraTextNoticeable: z
    .boolean()
    .default(true)
    .describe(
      'True when any lettering listed under extraText is something a viewer would notice and try to read at a glance: a misspelt or made-up word, a garbled sign or label, readable numbers. False when everything listed is small, faint or unreadable texture, such as scribbles on paper, tiny markings or blurred screen content. False when none is listed.'
    ),
  inventedFacts: z
    .array(z.string())
    .describe(
      'Statistics, numbers, prices, dates, names, products or claims the image shows that the post does not support.'
    ),
  foreignMarks: z
    .array(z.string())
    .describe(
      "Logos, wordmarks, brand or company names, signatures or watermarks other than the account's own name and its logo laid on by code."
    ),
  copiedFromExamples: z
    .array(z.string())
    .describe(
      "Content taken from the example images: their exact words or figures, the faces of their people, their product photos, other companies' logos. Following their layout, colours, typography, chart and icon style, and recurring motifs (such as an illustration that appears in the account's posts) is intended and is not listed."
    ),
  artifacts: z
    .array(z.string())
    .describe(
      'Visible flaws that give away a generated image and that a viewer would notice at a glance: malformed hands or faces, warped objects, impossible geometry, melted or duplicated things, plastic skin, garbled icons or shapes. Not layout or design opinions (where an arrow starts, what overlaps what), not a sketchy, hand-drawn or loose style the design means to have, not small imperfections, and not a drawing that leaves out a detail the words mention. Empty when nothing is worth making the image again for.'
    ),
  artifactsNoticeable: z
    .boolean()
    .describe(
      'True only when a flaw listed under artifacts would be noticed by a viewer at a glance and is worth making the image again for; false when the listed ones are minor, or none are listed.'
    ),
  matchesExamples: z
    .boolean()
    .describe(
      'True when the first image looks like it belongs with the examples: the same kind of image, layout family, colours, typography and finish.'
    ),
  summary: z
    .string()
    .describe('One or two sentences: what the image shows and how it holds up.')
})

export type LookReview = z.infer<typeof LookReviewSchema>

export type ReviewLookInput = {
  /** The image under review, downscaled. */
  image: Uint8Array
  mediaType: string
  /** The examples it was meant to follow, downscaled. */
  examples: Array<{ data: Uint8Array; mediaType: string }>
  postText: string
  concept: string
  /** The intended text parts, in reading order. */
  text: Array<{ part: string; text: string }>
  accountName: string
  /** The corner the real logo was laid on, in words; unset when none was. */
  logoCorner?: string
  abortSignal?: AbortSignal
}

export type ReviewLookResult = {
  review: LookReview | null
  error?: string
  usage: CallUsage
}
