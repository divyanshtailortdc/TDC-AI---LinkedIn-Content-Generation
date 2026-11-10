import { FORMATS, splitThread, threadColumns, type FormatId } from '@/lib/formats'
import { z } from 'zod'
import { DraftGenerationSchema } from '../post-drafting/schema'

/**
 * What the model returns for every non-LinkedIn format: one schema, with
 * each format's limits stated in the prompt instead. The schema is part of
 * the request's cached prefix (changing it invalidates the prompt cache), so
 * one shape for all formats is what lets an idea's second and later formats,
 * and the next idea's, read the shared instructions from cache.
 */
export const VariantOutputSchema = z.object({
  hook: z
    .string()
    .default('')
    .describe('The opening line. Empty for a thread, whose posts carry it.'),
  body: z
    .string()
    .default('')
    .describe(
      'The rest of the post after the hook; never repeat the hook. Plain text with real line breaks, no markdown. Empty for a thread.'
    ),
  cta: z
    .string()
    .default('')
    .describe(
      'Closing call to action; empty when none fits, and empty for a thread, whose last post carries the ask.'
    ),
  posts: z
    .array(z.string())
    .default([])
    .describe('A thread only: its posts in order, plain text, no numbering. Empty for a single post.'),
  linkComment: z
    .string()
    .optional()
    .describe(
      "Where the goal's link goes when it should not sit in the post (a first comment or a reply, as the request says). Empty when there is nothing to put there."
    ),
  hashtags: z
    .array(z.string())
    .default([])
    .describe('Hashtags without the # symbol, as many as the request allows'),
  alternateHooks: z
    .array(z.string())
    .min(2)
    .max(3)
    .describe('2 to 3 alternative openings; for a thread, alternative first posts'),
  visualIdea: z
    .string()
    .optional()
    .describe(
      'Instagram caption only: the image or short carousel the caption goes with, in one or two sentences. Empty for other formats.'
    ),
  shots: z
    .array(
      z.object({
        say: z.string().describe('The words spoken in this shot, as they will be said aloud'),
        show: z
          .string()
          .describe('What is on screen: the author to camera, a close-up, a screen recording, b-roll'),
        onScreenText: z
          .string()
          .optional()
          .describe('A few words of text overlay, if any')
      })
    )
    .default([])
    .describe('A video only: its shots in order, the first being the hook. Empty for other formats.'),
  caption: z
    .string()
    .optional()
    .describe('A video only: the text posted with it. Empty for other formats.'),
  title: z
    .string()
    .optional()
    .describe('A YouTube video only: its title, at most 100 characters. Empty for other formats.'),
  selfScores: DraftGenerationSchema.shape.selfScores,
  selfFlags: DraftGenerationSchema.shape.selfFlags
})

export type VariantOutput = z.infer<typeof VariantOutputSchema>

type SelfScores = VariantOutput['selfScores']

/** A drafted post in any non-LinkedIn format, in the columns every post has. */
export interface VariantDraft {
  hook: string
  body: string
  cta: string
  firstComment?: string
  hashtags: string[]
  alternateHooks: string[]
  payload: Record<string, unknown> | null
  selfScores: SelfScores
  selfFlags: string[]
}

/** The model's answer as a post in `formatId`. */
export function toVariantDraft(
  formatId: FormatId,
  output: Partial<VariantOutput> | null | undefined
): VariantDraft {
  const common = {
    firstComment: output?.linkComment?.trim() || undefined,
    hashtags: Array.isArray(output?.hashtags) ? output.hashtags : [],
    alternateHooks: Array.isArray(output?.alternateHooks) ? output.alternateHooks : [],
    selfScores: (output?.selfScores ?? {}) as SelfScores,
    selfFlags: Array.isArray(output?.selfFlags) ? output.selfFlags : []
  }
  if (FORMATS[formatId].structure === 'script') {
    // One paragraph per shot, so the editor edits the spoken words as text;
    // the last shot carries the closing ask.
    const shots = (Array.isArray(output?.shots) ? output.shots : [])
      .map(shot => ({
        say: (shot?.say ?? '').replace(/\n\s*\n/g, '\n').trim(),
        show: (shot?.show ?? '').trim(),
        onScreenText: shot?.onScreenText?.trim() || undefined
      }))
      .filter(shot => shot.say)
    const title = formatId === 'youtube.short' ? output?.title?.trim() || '' : ''
    return {
      ...common,
      hook: shots[0]?.say ?? '',
      body: shots.slice(1).map(s => s.say).join('\n\n'),
      cta: '',
      payload: {
        caption: output?.caption?.trim() ?? '',
        ...(title ? { title } : {}),
        shots: shots.map(({ show, onScreenText }) => ({ show, onScreenText }))
      }
    }
  }
  if (FORMATS[formatId].structure === 'thread') {
    // A thread written into hook and body instead of posts is still a thread.
    const posts =
      Array.isArray(output?.posts) && output.posts.length > 0
        ? output.posts
        : splitThread(output?.hook ?? '', output?.body ?? '')
    return { ...common, ...threadColumns(posts), cta: '', payload: null }
  }
  const visualIdea =
    formatId === 'instagram.caption' ? output?.visualIdea?.trim() || '' : ''
  return {
    ...common,
    hook: output?.hook ?? '',
    body: output?.body ?? '',
    cta: output?.cta ?? '',
    payload: visualIdea ? { visualIdea } : null
  }
}
