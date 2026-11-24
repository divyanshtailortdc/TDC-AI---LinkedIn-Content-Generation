import type { MediaBriefContext } from '@/lib/media/brief-context'
import { z } from 'zod'
import type { CallUsage } from '../../usage'
import type { PriorVisual } from '../media-brief/schema'

/**
 * The art director for an image made like the identity's own posts: it
 * looks at the account's example images, picks the ones this post should
 * follow, and says what the new image shows and exactly which words it
 * carries. Code turns that into the image model's prompt
 * (src/lib/media/learned-look.ts), with the chosen examples attached.
 */

export const LOOK_CORNERS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'none'
] as const
export type LookCorner = (typeof LOOK_CORNERS)[number]

/** Most words an image may carry, all parts together. */
export const LOOK_MAX_WORDS = 45

export const LookDesignSchema = z.object({
  examples: z
    .array(z.number().int())
    .describe(
      'The numbers of the 1 to 3 attached examples (1 = the first) the new image should follow most closely: the ones whose kind of image suits this post. They must be alike: never mix a photo with a text card.'
    ),
  kind: z
    .enum(['photo', 'graphic'])
    .describe(
      "'photo' when the chosen examples are photographs with little or no text on them; 'graphic' when they are designed images: text or quote cards, infographics, illustrations, layouts of shapes, icons and words."
    ),
  styleNotes: z
    .string()
    .describe(
      'What the chosen examples have in common, in words a designer could use: the kind of image, layout, background, colours, typography (weight, case, size), imagery or icons, density, finish, and where any logo sits. Two to four sentences.'
    ),
  concept: z
    .string()
    .describe(
      'One sentence: what this image shows and says. Earlier images are compared on it, so make it specific.'
    ),
  scene: z
    .string()
    .describe(
      "What the image shows, 40 to 120 words. For a photo: a real scene from this account's world that a camera could capture, what is happening, camera angle, framing, light and mood. For a graphic: the layout block by block (where each piece of text sits, its size and weight, the shapes, icons, illustration or photo in it) and which colours go where."
    ),
  text: z
    .array(
      z.object({
        part: z
          .string()
          .describe(
            'Where it goes: "title", "subtitle", "point 1", "label", "quote", "attribution", "button", "wordmark"...'
          ),
        text: z.string().describe('The words exactly as they should read.')
      })
    )
    .describe(
      `Every piece of text the image carries, in reading order, spelled exactly as it should appear. As much text as the chosen examples carry, never more than ${LOOK_MAX_WORDS} words in all; empty when they carry none.`
    ),
  logoCorner: z
    .enum(LOOK_CORNERS)
    .describe(
      "The corner where the chosen examples keep their logo or wordmark; 'none' when they show none."
    ),
  altText: z
    .string()
    .describe(
      'A description of the image for screen readers, under 300 characters.'
    )
})

export type LookDesign = z.infer<typeof LookDesignSchema>

/** One example image as the art director is shown it. */
export type LookExampleInput = {
  data: Uint8Array
  mediaType: string
  /** "Instagram", the platform it was posted on. */
  platformName: string
  /** True when it was posted on the platform this image is for. */
  samePlatform: boolean
  /** Uploaded by the user rather than found on the profile. */
  uploaded: boolean
  /** "4:5", "1:1"..., when known. */
  aspect?: string
}

export type DesignLookInput = {
  postText: string
  /** The post's platform, and the shape the image is made at in words. */
  platform: { name: string; shape: string }
  context: MediaBriefContext
  examples: LookExampleInput[]
  /** True when the brand's real logo is laid on afterwards. */
  logoFile: boolean
  /** The reviewer's words, or the approved idea's visual direction. */
  direction?: string
  previousVersions?: PriorVisual[]
  rejectionReason?: string
}

export type DesignLookResult =
  | { design: LookDesign; usage: CallUsage }
  | { design: null; error: string; usage: CallUsage }
