import { z } from 'zod'

/**
 * What the model returns for uploaded media: first what it sees, then one
 * post per platform written from that. Looking comes first in the schema so
 * the posts are written after the description, and rest on it.
 *
 * No length or count constraints here: the structured-output mode refuses
 * some of them, and the guard enforces the platform's own limits instead.
 */

export const MediaAnalysisSchema = z.object({
  summary: z
    .string()
    .describe(
      'One or two plain sentences: what the image or video shows, as seen.'
    ),
  details: z
    .array(z.string())
    .describe(
      'Concrete things that can be seen (people and what they do, objects, setting, colours, actions, what changes across the frames), one per item.'
    ),
  visibleText: z
    .array(z.string())
    .describe(
      'Words readable in the media, exactly as written. Empty when there are none.'
    ),
  mood: z.string().describe('The feel of the media in a few words.'),
  uncertain: z
    .array(z.string())
    .describe(
      'What cannot be told from the media alone (who someone is, where or when it is, what is said), so the posts do not claim it.'
    )
})

export const MediaPostItemSchema = z.object({
  platform: z
    .string()
    .describe('The platform id, exactly as listed in the request.'),
  hook: z.string().describe('The opening line(s) that stop the scroll.'),
  body: z
    .string()
    .describe('The rest of the caption, after the hook. May be empty.'),
  cta: z
    .string()
    .describe('The call to action. Empty when none follows naturally.'),
  hashtags: z.array(z.string()).describe('Hashtags without the # sign.'),
  firstComment: z
    .string()
    .describe(
      "The platform's comment field as described for it; empty when it needs none."
    ),
  title: z
    .string()
    .describe('The video title, for YouTube only; empty everywhere else.'),
  altText: z
    .string()
    .describe(
      'For an image: a plain description for screen readers. Empty for a video.'
    ),
  mediaDetails: z
    .array(z.string())
    .describe('The details from your description that this post refers to.')
})

export const MediaPostSchema = z.object({
  analysis: MediaAnalysisSchema,
  posts: z.array(MediaPostItemSchema)
})

export type MediaAnalysis = z.infer<typeof MediaAnalysisSchema>
export type MediaPostItem = z.infer<typeof MediaPostItemSchema>
export type MediaPostOutput = z.infer<typeof MediaPostSchema>

/** A request to shorten posts that ran over their platform's limit. */
export const ShortenSchema = z.object({
  posts: z.array(MediaPostItemSchema)
})
