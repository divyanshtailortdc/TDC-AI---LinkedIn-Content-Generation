import type { PlatformId } from '@/lib/formats'
import type { InsightPost } from '@/lib/profile-insights/types'
import { z } from 'zod'

/**
 * What the model returns about an account's posts on one platform. The
 * shape is ProfileInsights' (src/lib/profile-insights/types.ts), and
 * cleanProfileInsights is its guard: lengths, hashtags and repeats.
 */
export const ProfileAnalysisSchema = z.object({
  summary: z
    .string()
    .describe(
      'Two or three sentences about the account itself: what it posts on this platform and how it comes across. Nothing here about what could or could not be read.'
    ),
  themes: z
    .array(
      z.object({
        name: z.string().describe('The subject in two to five words.'),
        description: z
          .string()
          .describe(
            'One sentence in your own words: what the account says or shows about it. No quotes from the posts.'
          )
      })
    )
    .describe(
      'The 3 to 6 subjects the account keeps coming back to, most frequent first.'
    ),
  writingStyle: z
    .string()
    .describe(
      'Three to five sentences another writer can follow: how posts open, how long they run, sentence length and line breaks, recurring structures quoted as short templates, how they close. Say when only openings could be read.'
    ),
  tone: z
    .string()
    .describe(
      'The voice in one or two sentences: register, humour, warmth, language mix.'
    ),
  captions: z
    .string()
    .describe(
      'Caption habits in two or three sentences: length, line breaks, emoji (which and how many), calls to action, mentions, language mix.'
    ),
  hashtags: z
    .array(z.string())
    .describe(
      'Hashtags that appear in these posts, most used first. Only ones actually seen; empty when none are.'
    ),
  hashtagUsage: z
    .string()
    .describe(
      'One sentence: how many hashtags a post carries, where, and whether branded, campaign or generic. "None used" when none are.'
    ),
  visualIdentity: z
    .string()
    .describe(
      'From the attached images: photography or graphics, subjects, people, colours, text on images, recurring templates, framing. Empty string when no image was attached and the posts say nothing about their visuals.'
    ),
  formats: z
    .array(
      z.object({
        format: z
          .string()
          .describe(
            'The kind of post: "Reels", "Single photos", "Carousels", "Text posts", "Threads", "Videos".'
          ),
        note: z
          .string()
          .describe('One sentence: what it is used for, or how often.')
      })
    )
    .describe('The kinds of post the account makes, most common first.')
})

export type ProfileAnalysisOutput = z.infer<typeof ProfileAnalysisSchema>

export type AnalyzeProfileInput = {
  platform: PlatformId
  /** The account as the app knows it, to read its posts in context. */
  account: {
    name: string
    accountType: string
    industry?: string | null
    bio?: string | null
  }
  profile: {
    url: string
    handle: string
    displayName?: string
    /** The profile's own description, as the search engine shows it. */
    bio?: string
  }
  posts: InsightPost[]
  /** Images from some of the posts, in the order of `imagePosts`. */
  images: Array<{ data: Uint8Array; mediaType: string }>
  /** For each image, the post (its url) it is from. */
  imagePosts: string[]
  abortSignal?: AbortSignal
}
