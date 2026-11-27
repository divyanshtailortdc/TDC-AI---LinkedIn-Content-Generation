import 'server-only'

import type { FormatId } from '@/lib/formats'
import { overLimitMessage } from '@/lib/formats/text'
import type { PlatformId } from '@/lib/platforms'
import { postTextOf, type MediaPostDraft } from '~/lib/media-upload/drafts'
import type { ModelImage } from '~/lib/media-upload/inspect'
import type { GenerationContext } from '../../context'
import { runSkill, SkillError } from '../../run-skill'
import { addUsage, EMPTY_USAGE, type CallUsage } from '../../usage'
import { itemFor, toDraft } from './guard'
import {
  buildFixPrompt,
  buildInstructions,
  buildPrompt,
  type MediaFacts
} from './prompt'
import { mediaPostProblems, verifiedAnalysis } from './quality'
import { FixSchema, MediaPostSchema, type MediaAnalysis } from './schema'

export type { MediaFacts } from './prompt'
export type { MediaAnalysis } from './schema'

/** The user waits on this: a call that takes longer fails instead. */
const WRITE_TIMEOUT_MS = 150_000
/**
 * The one rewrite of posts that failed their checks. With the first call's
 * 150 s and reading the video, it ends inside the route's 300 s.
 */
const FIX_TIMEOUT_MS = 75_000

export interface MediaPostResult {
  analysis: MediaAnalysis
  posts: MediaPostDraft[]
  usage: CallUsage
}

/**
 * How far a post is from going out as it should: each failed check counts
 * one, a post over its platform's limit (which cannot be published) far
 * more, and an empty one most. A rewrite is kept only when it scores lower.
 */
function scoreOf(draft: MediaPostDraft, problems: readonly string[]): number {
  if (!draft.hook && !draft.body) return 1_000
  const over = overLimitMessage(draft.formatId, postTextOf(draft)) ? 100 : 0
  return over + problems.length
}

/**
 * Skill: an uploaded image (or a video's frames) and the platforms picked in;
 * what the media shows and what it is for, and a post for each platform
 * written from it, out. Each post is checked (./quality: its platform's
 * limit, invented claims, retelling the video, advert language, repeated
 * wording, demo sample data, the closing question); those that fail get one
 * rewrite, kept only where it is better. What is still long after that is
 * left for the user to cut, and the page says so.
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
  const kind = input.media.kind
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
  // Each feature held to the frames it names: one no frame shows is a guess,
  // taken out here and caught if a post names it.
  const { analysis, unverified } = verifiedAnalysis(
    written.output.analysis,
    input.pictures.length,
    input.notes
  )
  let posts = input.targets.map(t =>
    toDraft(t.platform, t.formatId, itemFor(written.output.posts, t.platform), {
      kind,
      voiceMaxHashtags
    })
  )
  if (posts.every(p => !p.hook && !p.body)) {
    throw new SkillError('The model wrote no posts for this media.', 'failed', {
      usage
    })
  }

  const check = { ctx: input.ctx, kind, analysis, notes: input.notes, unverified }
  const problems = posts.map(post =>
    post.hook || post.body ? mediaPostProblems(post, check) : []
  )
  const failing = posts.filter((_, i) => problems[i]!.length > 0)
  if (failing.length > 0 && !input.abortSignal?.aborted) {
    try {
      const fixed = await runSkill({
        stage: 'media_post',
        instructions,
        prompt: buildFixPrompt(
          input.ctx,
          { kind, analysis, notes: input.notes },
          failing,
          failing.map(post => problems[posts.indexOf(post)]!)
        ),
        schema: FixSchema,
        timeoutMs: FIX_TIMEOUT_MS,
        maxRetries: 0,
        abortSignal: input.abortSignal
      })
      usage = addUsage(usage, fixed.usage)
      posts = posts.map((post, i) => {
        const item = itemFor(fixed.output.posts, post.platform)
        if (!item || !failing.includes(post)) return post
        const rewritten = toDraft(post.platform, post.formatId, item, {
          kind,
          voiceMaxHashtags
        })
        // Keep the alt text from the first pass when the rewrite dropped it.
        const next = {
          ...rewritten,
          altText: rewritten.altText || post.altText
        }
        return scoreOf(next, mediaPostProblems(next, check)) <
          scoreOf(post, problems[i]!)
          ? next
          : post
      })
    } catch (err) {
      if (err instanceof SkillError) usage = addUsage(usage, err.usage)
      // The posts stay as written: the page shows what is too long.
      if (input.abortSignal?.aborted) throw err
      console.warn('Fixing media posts failed; keeping them as written:', err)
    }
  }

  return { analysis, posts, usage: usage ?? EMPTY_USAGE }
}
