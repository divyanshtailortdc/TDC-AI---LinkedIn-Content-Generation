import 'server-only'

import type { FormatId } from '@/lib/formats'
import { overLimitMessage } from '@/lib/formats/text'
import type { PlatformId } from '@/lib/platforms'
import { postTextOf, type MediaPostDraft } from '~/lib/media-upload/drafts'
import type { ModelImage } from '~/lib/media-upload/inspect'
import type { GenerationContext } from '../../context'
import { runSkill, SkillError } from '../../run-skill'
import { addUsage, EMPTY_USAGE, type CallUsage } from '../../usage'
import { itemFor, overLimit, toDraft } from './guard'
import {
  buildInstructions,
  buildPrompt,
  buildShortenPrompt,
  type MediaFacts
} from './prompt'
import { MediaPostSchema, ShortenSchema, type MediaAnalysis } from './schema'

export type { MediaFacts } from './prompt'
export type { MediaAnalysis } from './schema'

/** The user waits on this: a call that takes longer fails instead. */
const WRITE_TIMEOUT_MS = 150_000
const SHORTEN_TIMEOUT_MS = 60_000

export interface MediaPostResult {
  analysis: MediaAnalysis
  posts: MediaPostDraft[]
  usage: CallUsage
}

/**
 * Skill: an uploaded image (or a video's frames) and the platforms picked in;
 * what the media shows, and a post for each platform written from it, out.
 * Posts still over their platform's limit get one pass to shorten them; what
 * is still long after that is left for the user to cut, and the page says so.
 * Throws SkillError when the model cannot be reached or answers nothing usable.
 */
export async function writeMediaPosts(input: {
  ctx: GenerationContext
  media: MediaFacts
  /** The image, or the video's frames in order. */
  pictures: ModelImage[]
  targets: Array<{ platform: PlatformId; formatId: FormatId }>
  notes: string
  abortSignal?: AbortSignal
}): Promise<MediaPostResult> {
  const instructions = buildInstructions(input.ctx)
  const voiceMaxHashtags = input.ctx.prefs.constraints.hashtags?.max ?? 3
  const written = await runSkill({
    stage: 'media_post',
    instructions,
    prompt: buildPrompt(input.ctx, {
      media: input.media,
      targets: input.targets,
      notes: input.notes
    }),
    images: input.pictures,
    schema: MediaPostSchema,
    timeoutMs: WRITE_TIMEOUT_MS,
    maxRetries: 1,
    abortSignal: input.abortSignal
  })
  let usage = written.usage
  const { analysis } = written.output
  let posts = input.targets.map(t =>
    toDraft(t.platform, t.formatId, itemFor(written.output.posts, t.platform), {
      kind: input.media.kind,
      voiceMaxHashtags
    })
  )
  if (posts.every(p => !p.hook && !p.body)) {
    throw new SkillError('The model wrote no posts for this media.', 'failed', {
      usage
    })
  }

  const long = overLimit(posts)
  if (long.length > 0 && !input.abortSignal?.aborted) {
    try {
      const shortened = await runSkill({
        stage: 'media_post',
        instructions,
        prompt: buildShortenPrompt(
          input.ctx,
          long,
          input.media.kind,
          long.map(d => overLimitMessage(d.formatId, postTextOf(d)) ?? '')
        ),
        schema: ShortenSchema,
        timeoutMs: SHORTEN_TIMEOUT_MS,
        maxRetries: 0,
        abortSignal: input.abortSignal
      })
      usage = addUsage(usage, shortened.usage)
      posts = posts.map(post => {
        const item = itemFor(shortened.output.posts, post.platform)
        if (!item || !long.includes(post)) return post
        const next = toDraft(post.platform, post.formatId, item, {
          kind: input.media.kind,
          voiceMaxHashtags
        })
        // Keep the alt text from the first pass when the rewrite dropped it.
        return { ...next, altText: next.altText || post.altText }
      })
    } catch (err) {
      if (err instanceof SkillError) usage = addUsage(usage, err.usage)
      // The long posts stay as written: the page shows what to cut.
      if (input.abortSignal?.aborted) throw err
      console.warn(
        'Shortening media posts failed; keeping them as written:',
        err
      )
    }
  }

  return { analysis, posts, usage: usage ?? EMPTY_USAGE }
}
