import type { PlatformId } from '@/lib/platforms'
import type { InsightPost, ProfileInsights } from '@/lib/profile-insights/types'
import { z } from 'zod'

/**
 * What the model returns: the structure and look of a short vertical video
 * of text slides, matched to the account's own recent posts.
 * cleanVideoLook (src/lib/video/render/look.ts) is its guard.
 */
export const VideoLookSchema = z.object({
  format: z
    .enum(['slides', 'kinetic', 'meme', 'poster', 'editorial'])
    .describe(
      'How the video is built, after how their recent posts are built. slides: an opening title card, numbered slides under story progress bars, a closing card, soft fades; for carousels, tips, how-tos, lists and explainers. kinetic: no cards, a few huge centred words per slide popping in one by one, slides alternating colours, hard cuts; for punchy one-liners, bold text graphics, hype and announcements. meme: a band of casual text on top and one of their photos filling the rest, hard cuts; for memes, trend riffs, relatable jokes and reaction posts; only when at least one attached image is a photo of theirs. poster: each slide a designed graphic, a framed photo of theirs when there is one, a pill tag, a short body line and a solid contact bar, pushed in; for branded graphics, offers, hiring, events, product features and infographics. editorial: centred quiet words between thin rules, slow fades; for quotes, reflections, premium brands and editorial feeds.'
    ),
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
  highlight: z
    .enum(['none', 'marker', 'color'])
    .describe(
      'How key words (numbers, else the closing words) stand out, as their images mark words: marker (a solid box behind them, like a highlighter), color (in the accent colour), none when their images never pick words out.'
    ),
  photos: z
    .array(z.number().int())
    .describe(
      'The numbers of the attached images, best first, that are photos of theirs and would sit well behind words or framed in a meme or poster (no screenshots of text, no logo alone, no image already covered in words), whatever template and format you choose. Empty when none are.'
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
  /** Their recent posts there, newest first where dated: what they are and how they open. */
  posts: InsightPost[]
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
