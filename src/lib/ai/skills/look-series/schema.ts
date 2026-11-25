import type { MediaBriefContext } from '@/lib/media/brief-context'
import type { RecentLookInput } from '@/lib/visual-examples/recent'
import { z } from 'zod'
import type { CallUsage } from '../../usage'
import {
  LOOK_CORNERS,
  type LookExampleInput
} from '../look-design/schema'

/**
 * The art director for a carousel made like the identity's own posts: it
 * looks at the account's example images once and sets one design for every
 * slide, and what each slide shows beside its words. The words themselves
 * are the slide writer's, set exactly as written (src/lib/carousel/look.ts).
 */

export const LookSeriesSchema = z.object({
  examples: z
    .array(z.number().int())
    .describe(
      'The numbers of the 1 to 3 attached examples (1 = the first) every slide should follow: alike, and the kind of image that suits slides carrying these words. Never mix a photo with a text card.'
    ),
  kind: z
    .enum(['photo', 'graphic'])
    .describe(
      "'photo' when the chosen examples are photographs with little text on them; 'graphic' when they are designed images: text or quote cards, infographics, illustrations, layouts of shapes, icons and words."
    ),
  styleNotes: z
    .string()
    .describe(
      'The one design every slide keeps, in words a designer could use: the kind of image, background, colours, typefaces (weight, case, size), where the main line and any smaller line sit, imagery or icons, density, finish, and where any logo or wordmark sits. Three to five sentences.'
    ),
  wordmark: z
    .boolean()
    .describe(
      "True when the chosen examples show the account's name or wordmark on the image."
    ),
  logoCorner: z
    .enum(LOOK_CORNERS)
    .describe(
      "The corner where the chosen examples keep their logo or wordmark; 'none' when they show none."
    ),
  slides: z
    .array(
      z.object({
        scene: z
          .string()
          .describe(
            "What this slide shows beside its words, 20 to 80 words. For a graphic: where its words sit and anything drawn with them (a simple illustration, icon, shape or photo) in the set's style. For a photo: the real scene a camera could capture, with the words placed where the examples place theirs."
          ),
        concept: z
          .string()
          .describe('One sentence: what this slide shows and says.')
      })
    )
    .describe('One entry per slide, in the order the slides are given.')
})

export type LookSeries = z.infer<typeof LookSeriesSchema>

/** One slide as the art director is shown it. */
export type LookSeriesSlide = {
  role: 'cover' | 'content' | 'cta'
  headline: string
  body: string
  /** What the slide writer pictured beside the words. */
  idea: string
}

export type DesignLookSeriesInput = {
  /** The caption posted beside the slides. */
  caption: string
  slides: LookSeriesSlide[]
  /** The platform, and the shape every slide is made at in words. */
  platform: { name: string; shape: string }
  context: MediaBriefContext
  examples: LookExampleInput[]
  /** True when the brand's real logo is laid on afterwards. */
  logoFile: boolean
  /** What the reviewer asked for when the carousel was written again. */
  direction?: string | null
  /** The account's latest images and carousels on this platform, newest first. */
  recentLooks?: RecentLookInput[]
}

export type DesignLookSeriesResult =
  | { series: LookSeries; usage: CallUsage }
  | { series: null; error: string; usage: CallUsage }
