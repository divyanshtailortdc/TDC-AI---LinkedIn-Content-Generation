import { formatHashtags, platformPostText, toPlatformText } from '@/lib/post-text'
import { countChars } from './count'
import { FORMATS, PLATFORMS } from './registry'
import type { FormatId } from './types'

/**
 * A post's text as each platform takes it. Stored posts keep the columns the
 * LinkedIn pipeline always had (hook, body, call to action, hashtags); a
 * thread keeps its first post in `hook` and the rest in `body`, one post per
 * block, separated by a line holding only "---", so the existing editor can
 * edit a thread as text.
 */

export const THREAD_SEPARATOR = '\n\n---\n\n'
const SEPARATOR_LINE = /\n[ \t]*-{3,}[ \t]*(?:\n|$)/

export interface PostText {
  hook: string
  body: string
  cta?: string | null
  hashtags?: string[] | null
  /** A video's caption, title and shots live here (see videoScriptOf). */
  payload?: Record<string, unknown> | null
}

/**
 * A short video: the spoken words sit in the text columns (the first shot in
 * `hook`, one shot per paragraph in `body`, the closing ask in `cta`), so the
 * editor edits them as text; what each shot shows, the caption and the title
 * sit in `payload`.
 */
export interface VideoShot {
  say: string
  show: string
  onScreenText?: string
  /** When the shot starts, estimated from the words spoken before it. */
  startsAt: number
}

/** Speaking pace for estimating a script's length: about 150 words a minute. */
export const WORDS_PER_SECOND = 2.5

export function spokenSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.round(words / WORDS_PER_SECOND)
}

const str = (value: unknown) => (typeof value === 'string' ? value : '')

/** A video's shots, caption and title, from its stored columns. */
export function videoScriptOf(post: PostText): {
  shots: VideoShot[]
  caption: string
  title: string
  seconds: number
} {
  const payload = post.payload ?? {}
  const stored = Array.isArray(payload.shots) ? (payload.shots as unknown[]) : []
  const spoken = [post.hook, ...post.body.split(/\n\s*\n/), post.cta ?? '']
    .map(s => s.trim())
    .filter(Boolean)
  let elapsed = 0
  const shots = spoken.map((say, i) => {
    const info = (stored[i] ?? {}) as Record<string, unknown>
    const shot: VideoShot = {
      say,
      show: str(info.show),
      onScreenText: str(info.onScreenText) || undefined,
      startsAt: elapsed
    }
    elapsed += spokenSeconds(say)
    return shot
  })
  return {
    shots,
    caption: str(payload.caption),
    title: str(payload.title),
    seconds: elapsed
  }
}

/** The posts of a thread, in order, from its stored hook and body. */
export function splitThread(hook: string, body: string): string[] {
  return [hook, ...body.split(SEPARATOR_LINE)]
    .map(part => part.trim())
    .filter(Boolean)
}

/** A thread's posts as the stored hook and body. */
export function threadColumns(posts: string[]): { hook: string; body: string } {
  const parts = posts.map(p => p.trim()).filter(Boolean)
  return { hook: parts[0] ?? '', body: parts.slice(1).join(THREAD_SEPARATOR) }
}

/**
 * One part of a post as plain text for platforms other than LinkedIn:
 * markdown and HTML become what they show, as for LinkedIn, but emphasis
 * stays plain words instead of Unicode bold, which screen readers spell out.
 */
export function toPlainText(text: string | null | undefined): string {
  if (!text) return ''
  return toPlatformText(text.replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2'))
}

/** Hashtags as one line, "#one #two", each tag once. */
export const hashtagLine = (tags: string[] | null | undefined) =>
  formatHashtags(tags).join(' ')

/**
 * The text each length limit applies to: the whole post (hashtags included,
 * since they share the post's space), or each post of a thread, with the
 * hashtags on the last.
 */
export function limitedTexts(formatId: FormatId, post: PostText): string[] {
  const spec = FORMATS[formatId]
  const tags = hashtagLine(post.hashtags)
  if (spec.structure === 'script') {
    // The caption is what is posted as text; the script is spoken.
    const caption = videoScriptOf(post).caption
    return [[caption.trim(), tags].filter(Boolean).join('\n\n')]
  }
  if (spec.structure === 'thread') {
    const parts = splitThread(post.hook, post.body)
    if (tags && parts.length > 0) {
      parts[parts.length - 1] = `${parts[parts.length - 1]}\n\n${tags}`
    }
    return parts
  }
  return [
    [post.hook, post.body, post.cta, tags]
      .map(part => part?.trim())
      .filter(Boolean)
      .join('\n\n')
  ]
}

/** The post's length as its platform counts it (a thread's posts summed). */
export function formatCharCount(formatId: FormatId, post: PostText): number {
  const mode = FORMATS[formatId].limits.count
  return limitedTexts(formatId, post).reduce(
    (sum, text) => sum + countChars(text, mode),
    0
  )
}

const plainPost = (post: PostText): PostText => ({
  ...post,
  hook: toPlainText(post.hook),
  body: toPlainText(post.body),
  cta: toPlainText(post.cta)
})

/**
 * The post as it is published, one text per platform post: a single post's
 * whole text, or each post of a thread in order. Joined by "---" lines, it is
 * what Copy gives.
 */
export function postTexts(formatId: FormatId, post: PostText): string[] {
  return FORMATS[formatId].structure === 'thread'
    ? limitedTexts(formatId, plainPost(post))
    : [copyText(formatId, post)]
}

/**
 * Why the post is too long to go out, or null: the first of its posts (each
 * post of a thread) over the format's hard limit, as its platform counts. A
 * reply that is published as a post of its own (X) is held to it too.
 */
export function overLimitMessage(
  formatId: FormatId,
  post: PostText & { firstComment?: string | null }
): string | null {
  const spec = FORMATS[formatId]
  const posts = postTexts(formatId, post)
  const reply =
    spec.links.fallback === 'reply' ? toPlainText(post.firstComment).trim() : ''
  const texts = reply ? [...posts, reply] : posts
  const lengths = texts.map(text => countChars(text, spec.limits.count))
  const i = lengths.findIndex(length => length > spec.limits.maxChars)
  if (i === -1) return null
  const what =
    i >= posts.length
      ? `The ${spec.commentLabel.toLowerCase()}`
      : posts.length > 1
        ? `Post ${i + 1} of the thread`
        : 'The post'
  return `${what} is ${lengths[i]} characters; ${PLATFORMS[spec.platform].label} allows ${spec.limits.maxChars}${
    spec.limits.count === 'x_weighted' ? ' (a link counts as 23, an emoji as 2)' : ''
  }. Shorten it first.`
}

/**
 * The post as Copy puts it on the clipboard. LinkedIn keeps its own text
 * (a bold hook); other platforms get plain text, and a thread its posts with
 * a "---" line between them, to paste one at a time.
 */
/**
 * What is posted with a video as text: its caption and hashtags, without the
 * script. Empty for a format that is not a video.
 */
export function videoCaptionText(formatId: FormatId, post: PostText): string {
  if (FORMATS[formatId].structure !== 'script') return ''
  return limitedTexts(formatId, plainPost(post))[0] ?? ''
}

export function copyText(formatId: FormatId, post: PostText): string {
  if (formatId === 'linkedin.post') return platformPostText(post)
  if (FORMATS[formatId].structure === 'thread') {
    return postTexts(formatId, post).join(THREAD_SEPARATOR)
  }
  const plain = plainPost(post)
  if (FORMATS[formatId].structure === 'script') {
    const script = videoScriptOf(plain)
    const lines: string[] = []
    if (script.title) lines.push(`TITLE\n${script.title}`, '')
    lines.push(`SCRIPT (about ${script.seconds} seconds)`)
    script.shots.forEach((shot, i) => {
      lines.push(`${i + 1}. Say: ${shot.say}`)
      if (shot.show) lines.push(`   Show: ${shot.show}`)
      if (shot.onScreenText) lines.push(`   On screen: ${shot.onScreenText}`)
    })
    const caption = limitedTexts(formatId, plain)[0]
    if (caption) lines.push('', 'CAPTION', caption)
    return lines.join('\n')
  }
  return limitedTexts(formatId, plain)[0] ?? ''
}
