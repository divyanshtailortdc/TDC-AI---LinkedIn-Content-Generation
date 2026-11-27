import { FORMATS, type FormatId } from '@/lib/formats'
import { overLimitMessage, type PostText } from '@/lib/formats/text'
import type { PlatformId } from '@/lib/platforms'
import { formatHashtags } from '@/lib/post-text'

/**
 * One platform's post made from uploaded media, as the Create from media page
 * edits it, and how it is stored. Pure: the page, the server and tests share it.
 */
export interface MediaPostDraft {
  platform: PlatformId
  formatId: FormatId
  hook: string
  body: string
  cta: string
  hashtags: string[]
  /** The platform's comment field (first comment, reply, link-in-bio note). */
  firstComment: string
  /** A YouTube Short's title; empty elsewhere. */
  title: string
  /** The image's description for screen readers; empty for a video. */
  altText: string
}

/** Longest a YouTube title may be. */
export const VIDEO_TITLE_MAX = 100

/**
 * A video format's (YouTube Short's) posted text is its caption, kept in the
 * payload; its text columns hold a script, which an uploaded video has none
 * of. So the hook, body and call to action go out as one caption there.
 */
const isScriptFormat = (formatId: FormatId) =>
  FORMATS[formatId].structure === 'script'

export const captionOf = (
  draft: Pick<MediaPostDraft, 'hook' | 'body' | 'cta'>
) =>
  [draft.hook, draft.body, draft.cta]
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n\n')

/** The post's columns as post_drafts stores them. */
export function draftColumnsOf(draft: MediaPostDraft): {
  hook: string
  body: string
  cta: string | null
  hashtags: string[]
  firstComment: string | null
  /** Merged into the post's payload. */
  payload: Record<string, unknown>
} {
  const hashtags = formatHashtags(draft.hashtags).map(tag => tag.slice(1))
  const firstComment = draft.firstComment.trim() || null
  if (isScriptFormat(draft.formatId)) {
    return {
      hook: '',
      body: '',
      cta: null,
      hashtags,
      firstComment,
      payload: {
        caption: captionOf(draft).slice(0, 5000),
        title: draft.title.trim().slice(0, VIDEO_TITLE_MAX)
      }
    }
  }
  return {
    hook: draft.hook.trim(),
    body: draft.body.trim(),
    cta: draft.cta.trim() || null,
    hashtags,
    firstComment,
    payload: {}
  }
}

/** The post as the length checks read it. */
export function postTextOf(
  draft: MediaPostDraft
): PostText & { firstComment: string | null } {
  const columns = draftColumnsOf(draft)
  return {
    hook: columns.hook,
    body: columns.body,
    cta: columns.cta,
    hashtags: columns.hashtags,
    payload: columns.payload,
    firstComment: columns.firstComment
  }
}

/** Why the post cannot go out as it is, or null: empty, too long, or a Short without a title. */
export function mediaPostProblem(draft: MediaPostDraft): string | null {
  if (!captionOf(draft)) return 'Write the caption first.'
  if (isScriptFormat(draft.formatId) && !draft.title.trim())
    return 'Give the video a title.'
  return overLimitMessage(draft.formatId, postTextOf(draft))
}

/**
 * What Regenerate rewrites in a post made from uploaded media: the hook
 * alone, the body alone (the hook, closing question and hashtags stay), or
 * the whole post. Nothing else in the post changes, nor its media.
 */
export const MEDIA_POST_PARTS = ['hook', 'body', 'post'] as const
export type MediaPostPart = (typeof MEDIA_POST_PARTS)[number]

export const isMediaPostPart = (value: unknown): value is MediaPostPart =>
  typeof value === 'string' &&
  (MEDIA_POST_PARTS as readonly string[]).includes(value)

/**
 * The post with `part` taken from `rewritten` and everything else as it is
 * in `current`. A rewritten body brings its closing question only where the
 * post had none; a rewritten post keeps the image's alt text, which
 * describes the image, not the post.
 */
export function withRewrittenPart(
  current: MediaPostDraft,
  rewritten: MediaPostDraft,
  part: MediaPostPart
): MediaPostDraft {
  switch (part) {
    case 'hook':
      return { ...current, hook: rewritten.hook }
    case 'body':
      return {
        ...current,
        body: rewritten.body,
        cta: current.cta.trim() ? current.cta : rewritten.cta
      }
    case 'post':
      return { ...rewritten, altText: current.altText || rewritten.altText }
  }
}

/**
 * A saved post made from uploaded media, as the Create from media page held
 * it, so a part of it can be written again. A Short keeps one caption (see
 * draftColumnsOf): its first paragraph is taken as the hook, and a closing
 * question ending it as the call to action.
 */
export function mediaDraftOfPost(
  post: {
    platform: PlatformId
    formatId: FormatId
    hook: string
    body: string
    cta: string | null
    hashtags: string[] | null
    firstComment: string | null
    payload: Record<string, unknown> | null
  },
  altText: string | null = null
): MediaPostDraft {
  const common = {
    platform: post.platform,
    formatId: post.formatId,
    hashtags: post.hashtags ?? [],
    firstComment: post.firstComment ?? '',
    altText: altText ?? ''
  }
  if (!isScriptFormat(post.formatId)) {
    return {
      ...common,
      hook: post.hook,
      body: post.body,
      cta: post.cta ?? '',
      title: ''
    }
  }
  const text = (key: string) =>
    typeof post.payload?.[key] === 'string' ? (post.payload[key] as string) : ''
  const paragraphs = text('caption')
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
  const last = paragraphs.length > 2 ? paragraphs[paragraphs.length - 1]! : ''
  const cta = last.endsWith('?') ? last : ''
  return {
    ...common,
    hook: paragraphs[0] ?? '',
    body: paragraphs.slice(1, cta ? -1 : undefined).join('\n\n'),
    cta,
    title: text('title')
  }
}
