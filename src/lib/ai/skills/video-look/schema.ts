import type { PlatformId } from '@/lib/platforms'
import type { ProfileInsights } from '@/lib/profile-insights/types'
import { z } from 'zod'

/**
 * What the model returns: the look of a short vertical video made of title
 * cards and text slides, matched to the account's own posts.
 * cleanVideoLook (src/lib/video/render/look.ts) is its guard.
 */
export const VideoLookSchema = z.object({
  template: z
    .enum(['cards', 'bold', 'minimal', 'photo'])
    .describe(
      'cards: deep-coloured title cards and light slides with dark words, for clean corporate graphics. bold: dark slides with big bright words and a strong accent, for bold graphic, infographic or meme-style text posts. minimal: light cards and light slides with quiet dark words and space, for minimal, editorial or pastel quote cards. photo: their own photos fill the screen behind the words, darkened, for photo-led feeds (people, products, places, food); only when at least one attached image is such a photo.'
    ),
  colors: z
    .object({
      background: z
        .string()
        .describe(
          'Hex colour of the slides’ background, as their posts use it: light for cards and minimal, dark for bold, a deep shade for the title cards of photo.'
        ),
      text: z.string().describe('Hex colour of the words on that background.'),
      accent: z
        .string()
        .describe(
          'Hex colour their posts use for highlights, numbers and marks.'
        )
    })
    .describe(
      'Colours seen in their posts. The brand colours the account set are used as they are, whatever you choose here; yours fill only what it left unset.'
    ),
  textCase: z
    .enum(['as_written', 'upper'])
    .describe(
      'upper only when the words on their images are usually all capitals.'
    ),
  captions: z
    .enum(['badge', 'subtitles'])
    .describe(
      'How the line under each slide is shown: badge (words in a solid rounded box) or subtitles (plain words, like burned-in captions). Follow how their images set small text.'
    ),
  pace: z
    .enum(['quick', 'steady', 'calm'])
    .describe(
      'quick for energetic, punchy feeds; calm for quiet, premium or reflective ones; otherwise steady.'
    ),
  photos: z
    .array(z.number().int())
    .describe(
      'The numbers of the attached images, best first, that are photos of theirs and would sit well behind words (no screenshots of text, no logo alone, no image already covered in words), whatever template you choose. Empty when none are.'
    ),
  reason: z
    .string()
    .describe(
      'One sentence: what in their posts led to this look. Name what you saw, not the account.'
    )
})

export interface DesignVideoLookInput {
  /** Where the video goes. */
  platform: PlatformId
  /** Whose analysis this is, when not the video's own platform. */
  insightsPlatform: PlatformId | null
  insights: ProfileInsights | null
  brand: {
    primaryColor: string | null
    accentColor: string | null
    backgroundColor: string | null
  }
  /** Example posts of theirs, as the model sees them. */
  images: Array<{
    data: Uint8Array
    mediaType: string
    width: number | null
    height: number | null
    platform: PlatformId
  }>
  abortSignal?: AbortSignal
}
