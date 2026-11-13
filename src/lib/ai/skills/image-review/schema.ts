import { z } from 'zod'
import type { ImageStyle } from '@/lib/brand/theme'
import type { CallUsage } from '../../usage'

export const ImageReviewSchema = z.object({
  visibleText: z
    .array(z.string())
    .describe(
      'Every piece of lettering visible in the image, transcribed exactly as drawn, misspellings and gibberish included. Empty when there is none.'
    ),
  headlineCorrect: z
    .boolean()
    .describe(
      'True when the intended headline appears spelled exactly as given; when no headline was intended, true only if the image carries no headline.'
    ),
  unintendedText: z
    .array(z.string())
    .describe(
      'Lettering that should not be there: anything besides the intended headline, including pseudo-words on screens, documents, signs, labels or packaging.'
    ),
  brandMarks: z
    .array(z.string())
    .describe(
      'Every logo, emblem, wordmark, brand or company name, signature or watermark drawn in the image, each described briefly.'
    ),
  unsupportedDetails: z
    .array(z.string())
    .describe(
      'Factual claims the image makes that the post does not support: statistics or numbers, named products, product screens or features, named places, events or real people. Not composition choices: extra props, figures illustrating the scene, or a different number of objects than described are fine.'
    ),
  logoCoversContent: z
    .boolean()
    .default(false)
    .describe(
      "Only when the brand's logo was laid over the image: true when it overlaps or hides part of the headline, a face or a key object. False when it sits on empty background, and false when no logo was added."
    ),
  logoCovers: z
    .array(z.string())
    .default([])
    .describe(
      'When logoCoversContent is true: what the logo covers. Otherwise empty.'
    ),
  copiesReference: z
    .boolean()
    .default(false)
    .describe(
      "Only when a reference image is attached: true when the image repeats the reference's own objects, props, devices, icons or scene, even recoloured, instead of showing a new subject in its arrangement. False when only the layout and drawing style match, and false when there is no reference."
    ),
  keepsReferenceColors: z
    .boolean()
    .default(false)
    .describe(
      'Only when a reference image is attached and brand colours are given: true when the image keeps colours from the reference that are neither brand colours nor white, grey or near-black, such as its background tint. False otherwise.'
    ),
  conveysPost: z
    .boolean()
    .describe(
      "True when a reader of this post would see that the image is about the post's specific point, not only its general subject."
    ),
  genericStock: z
    .boolean()
    .describe(
      'True when the image is a generic business, AI or technology scene that could sit on almost any post.'
    ),
  followsBrand: z
    .boolean()
    .describe(
      'True when the image uses the brand colours and style described, or when none were given.'
    ),
  artifacts: z
    .array(z.string())
    .default([])
    .describe(
      'Visible flaws that give away a generated image, each described briefly: malformed hands or faces, extra or merged fingers or limbs, warped or melted objects, impossible geometry, bent lines that should be straight, duplicated objects, plastic or waxy skin. Empty when there are none.'
    ),
  matchesStyle: z
    .boolean()
    .default(true)
    .describe(
      'Only when an intended style is given: true when the image is plainly in that style, false when, for example, an intended photograph looks illustrated, cartoonish or computer-rendered. True when no style is given.'
    ),
  relevanceScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      "How well the image carries this post's point: 90+ unmistakable, 70 clearly related, 50 loosely, under 40 unrelated."
    ),
  summary: z
    .string()
    .describe(
      'One sentence: what the image shows and how it relates to the post.'
    )
})

export type ImageReview = z.infer<typeof ImageReviewSchema>

export interface ReviewImageInput {
  /** The image as generated, before the logo is laid over it. */
  image: Buffer
  mediaType: string
  postText: string
  /** What the image was meant to show. */
  concept: string
  /** The one line of lettering allowed; empty when the image should have none. */
  headline: string
  /** The brand's colours and style as described to the art director, if any. */
  brand?: string
  /** Where the brand's real logo was laid over the image ("top left"), if it was. */
  logoCorner?: string
  /** The reference image the new one was meant to follow for layout and style. */
  reference?: { data: Uint8Array; mediaType: string }
  /** The image style it was asked for, so a photograph that looks drawn is caught. */
  style?: ImageStyle
  abortSignal?: AbortSignal
}

export interface ImageReviewVerdict {
  passed: boolean
  /** Plain-language problems, shown to the reviewer and fed to a retry. */
  issues: string[]
  relevanceScore: number
  summary: string
}

export interface ReviewImageResult {
  review: ImageReview | null
  verdict: ImageReviewVerdict | null
  /** Why no review came back, when it did not. */
  error?: string
  usage: CallUsage
}
