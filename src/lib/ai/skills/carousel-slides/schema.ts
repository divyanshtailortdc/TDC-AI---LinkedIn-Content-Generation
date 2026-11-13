import { SLIDE_LAYOUTS, SLIDE_ROLES } from '@/lib/carousel/types'
import { z } from 'zod'

/**
 * What the model returns for a carousel: its slides in swipe order. The
 * schema is the same for every carousel, so the instruction block before it
 * is read from cache from the second carousel on.
 */
export const SlideOutputSchema = z.object({
  role: z
    .enum(SLIDE_ROLES)
    .describe(
      'cover for the first slide, cta for the last, content for every one between'
    ),
  layout: z
    .enum(SLIDE_LAYOUTS)
    .describe(
      'How the slide is laid out; cover for the first, cta for the last'
    ),
  headline: z.string().describe('A few words, set large: at most 8 words'),
  body: z
    .string()
    .default('')
    .describe(
      'One or two short sentences, at most 30 words. A list slide: two to four short points, one per line. Empty when the headline says it all.'
    ),
  icon: z
    .string()
    .optional()
    .describe(
      'An icon slide only: one icon name from the list in the instructions'
    ),
  stat: z
    .string()
    .optional()
    .describe(
      'A stat slide only: the figure exactly as the evidence states it, e.g. "43%"'
    ),
  emphasis: z
    .array(z.string())
    .default([])
    .describe('One or two words of the headline to set in the accent colour'),
  imagePrompt: z
    .string()
    .describe(
      "The picture this slide would show, for the image model: a concrete scene from the post's world. Never text, signs, logos or screens with words."
    ),
  picture: z
    .boolean()
    .default(false)
    .describe(
      'True when this slide shows a generated picture (the cover, and at most one photo slide)'
    ),
  altText: z
    .string()
    .describe('The slide described for screen readers, its words included')
})

export type SlideOutput = z.infer<typeof SlideOutputSchema>

export const SlidesOutputSchema = z.object({
  slides: z.array(SlideOutputSchema).min(2).max(20)
})

export type SlidesOutput = z.infer<typeof SlidesOutputSchema>

/** One slide written again, on its own. */
export const OneSlideOutputSchema = z.object({ slide: SlideOutputSchema })
