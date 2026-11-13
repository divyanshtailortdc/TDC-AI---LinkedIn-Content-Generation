import {
  CAPTION_COPY_LIMIT,
  captionOnSlides,
  slideLengthIssues
} from '@/lib/carousel/checks'
import { countChars } from './count'
import { carouselSpecOf, carouselWording, MEDIA_FORMAT_LABELS } from './media'
import { FORMATS, PLATFORMS } from './registry'
import {
  formatCharCount,
  hashtagLine,
  limitedTexts,
  overLimitMessage,
  postTexts,
  toPlainText,
  videoScriptOf,
  type PostText
} from './text'
import type { FormatId, MediaFormat } from './types'

/**
 * Whether a post is ready for its platform: its caption against the
 * platform's limits and fold, its hashtags and links, the media the platform
 * needs (an Instagram post's image, a carousel's slides within the
 * platform's count), slides that repeat the caption, and a version that
 * reads the same as the idea's post on another platform. Pure: the review
 * screen shows the result, and publishing refuses a post with an error.
 */

export type CheckLevel = 'error' | 'warning' | 'info' | 'ok'

export interface PublishCheck {
  /** Stable, for keys and tests. */
  id: string
  level: CheckLevel
  /** A few words: "Caption length". */
  label: string
  message: string
}

export interface SlideSummary {
  position: number
  headline: string
  body: string
  status: 'ready' | 'failed'
}

export interface ValidationInput {
  formatId: FormatId
  mediaFormat: MediaFormat
  post: PostText & { firstComment?: string | null }
  /** The post's single image; null when it has none. */
  image: { present: boolean } | null
  /** A carousel's slides; null while they are not known (loading). */
  slides: SlideSummary[] | null
  /** The idea's posts on other platforms, as Copy gives them. */
  siblings?: Array<{ formatId: FormatId; text: string }>
}

/** Instagram's own limit on hashtags in one caption; more and the post is refused. */
export const INSTAGRAM_HASHTAG_LIMIT = 30

/** The caption's length against its platform's limits, for a meter. */
export interface CaptionMeter {
  label: string
  count: number
  max: number
  target: number
  /** Where the feed folds it; null when it does not. */
  fold: number | null
  /** A thread's posts, each with its own length. */
  parts: number[] | null
}

export function captionMeter(formatId: FormatId, post: PostText): CaptionMeter {
  const spec = FORMATS[formatId]
  const texts = limitedTexts(formatId, post)
  return {
    label:
      spec.structure === 'script'
        ? 'Caption'
        : spec.structure === 'thread'
          ? 'Longest post'
          : 'Caption',
    count:
      spec.structure === 'thread'
        ? Math.max(0, ...texts.map(t => countChars(t, spec.limits.count)))
        : formatCharCount(formatId, post),
    max: spec.limits.maxChars,
    target: spec.limits.targetChars,
    fold: spec.limits.foldChars,
    parts:
      spec.structure === 'thread'
        ? texts.map(t => countChars(t, spec.limits.count))
        : null
  }
}

// NFKD turns LinkedIn's Unicode-bold hook back into plain letters.
const words = (text: string) =>
  toPlainText(text)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

const runs = (w: string[], n = 4) => {
  const out = new Set<string>()
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '))
  return out
}

/**
 * How much of `a` is written out in `b`: the share of its four-word runs
 * found there. 1 when `a` was pasted into `b`.
 */
export function overlapShare(a: string, b: string): number {
  const own = runs(words(a))
  if (own.size === 0) return 0
  const other = runs(words(b))
  let found = 0
  for (const run of own) if (other.has(run)) found++
  return found / own.size
}

/** Above this share, a version reads as the same post as another platform's. */
export const REUSE_LIMIT = 0.6

const fmt = (n: number) => n.toLocaleString('en-US')
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`

export function validatePost(input: ValidationInput): PublishCheck[] {
  const { formatId, mediaFormat, post } = input
  const spec = FORMATS[formatId]
  const platform = PLATFORMS[spec.platform].label
  const checks: PublishCheck[] = []
  const caption = postTexts(formatId, post).join('\n\n')

  // ------------------------------------------------------------ the text
  const tooLong = overLimitMessage(formatId, post)
  const meter = captionMeter(formatId, post)
  checks.push(
    tooLong
      ? { id: 'length', level: 'error', label: 'Length', message: tooLong }
      : meter.count > meter.target * 1.6 && spec.structure !== 'thread'
        ? {
            id: 'length',
            level: 'warning',
            label: 'Length',
            message: `${fmt(meter.count)} of ${fmt(meter.max)} characters: within ${platform}'s limit, but well past the ${fmt(meter.target)} that read best here.`
          }
        : {
            id: 'length',
            level: 'ok',
            label: 'Length',
            message:
              spec.structure === 'thread'
                ? `Every post fits ${platform}'s ${fmt(meter.max)} characters (longest ${fmt(meter.count)}).`
                : `${fmt(meter.count)} of ${fmt(meter.max)} characters.`
          }
  )

  if (spec.structure !== 'script' && meter.fold) {
    const opening = toPlainText(
      spec.structure === 'thread' ? '' : post.hook
    ).trim()
    if (opening && countChars(opening, spec.limits.count) > meter.fold) {
      checks.push({
        id: 'fold',
        level: 'warning',
        label: 'Opening',
        message: `The opening line is ${fmt(countChars(opening, spec.limits.count))} characters; ${platform} shows only the first ${fmt(meter.fold)} before "more", so it is cut mid-thought.`
      })
    }
  }

  if (spec.structure === 'script') {
    const script = videoScriptOf(post)
    if (!script.caption.trim()) {
      checks.push({
        id: 'caption',
        level: 'warning',
        label: 'Caption',
        message: 'The video has no caption to post with it.'
      })
    }
    if (spec.platform === 'youtube' && script.title.length > 100) {
      checks.push({
        id: 'title',
        level: 'error',
        label: 'Title',
        message: `The title is ${script.title.length} characters; YouTube takes 100.`
      })
    }
  }

  // ----------------------------------------------------------- hashtags
  const tags = (post.hashtags ?? []).filter(t => t.trim())
  if (spec.platform === 'instagram' && tags.length > INSTAGRAM_HASHTAG_LIMIT) {
    checks.push({
      id: 'hashtags',
      level: 'error',
      label: 'Hashtags',
      message: `${tags.length} hashtags; Instagram refuses a post with more than ${INSTAGRAM_HASHTAG_LIMIT}.`
    })
  } else if (spec.hashtags !== 'voice') {
    const { min, max } = spec.hashtags
    if (tags.length > max || tags.length < min) {
      checks.push({
        id: 'hashtags',
        level: 'warning',
        label: 'Hashtags',
        message: `${plural(tags.length, 'hashtag')}; ${platform} posts do best with ${min === max ? min : `${min} to ${max}`}.`
      })
    } else if (tags.length > 0) {
      checks.push({
        id: 'hashtags',
        level: 'ok',
        label: 'Hashtags',
        message: `${plural(tags.length, 'hashtag')}: ${hashtagLine(tags)}`
      })
    }
  }

  // --------------------------------------------------------------- links
  if (
    spec.links.inBody === 'not_clickable' &&
    /\bhttps?:\/\/|\bwww\./i.test(caption)
  ) {
    checks.push({
      id: 'links',
      level: 'warning',
      label: 'Links',
      message: `Links in ${platform} captions cannot be clicked. Say the link is in the bio instead.`
    })
  }

  // --------------------------------------------------------------- media
  const wording = carouselWording(
    [
      post.hook,
      post.body,
      post.cta,
      spec.structure === 'script' ? videoScriptOf(post).caption : ''
    ]
      .filter(Boolean)
      .join('\n')
  )
  if (wording && mediaFormat !== 'carousel') {
    checks.push({
      id: 'swipe',
      level: 'error',
      label: 'Caption',
      message: `It says "${wording}", but the post goes out ${mediaFormat === 'image' ? 'with one image' : 'without slides'}. Remove it, or make the post a carousel.`
    })
  }

  if (mediaFormat === 'image') {
    const takesText = spec.media.formats.includes('text')
    checks.push(
      input.image?.present
        ? {
            id: 'media',
            level: 'ok',
            label: 'Media',
            message: 'One image goes out with the post.'
          }
        : {
            id: 'media',
            level: takesText ? 'warning' : 'error',
            label: 'Media',
            message: takesText
              ? 'No image yet: it goes out as text only until you add one.'
              : `${platform} posts need an image. Add one before publishing.`
          }
    )
  }

  if (mediaFormat === 'carousel') checks.push(...carouselChecks(input, caption))

  if (mediaFormat === 'video') {
    checks.push({
      id: 'media',
      level: 'info',
      label: 'Video',
      message: `A script to film: record the video, then post it on ${platform} with this caption.`
    })
  }

  // --------------------------------------------- the same post elsewhere
  for (const sibling of input.siblings ?? []) {
    if (sibling.formatId === formatId) continue
    const share = Math.max(
      overlapShare(caption, sibling.text),
      overlapShare(sibling.text, caption)
    )
    if (share >= REUSE_LIMIT) {
      checks.push({
        id: `reuse-${sibling.formatId}`,
        level: 'warning',
        label: 'Adapted',
        message: `Reads almost the same as the ${FORMATS[sibling.formatId].label}. Rewrite it for ${platform} (Regenerate does), so followers on both see two posts, not one twice.`
      })
    }
  }

  return checks
}

function carouselChecks(
  input: ValidationInput,
  caption: string
): PublishCheck[] {
  const spec = carouselSpecOf(input.formatId)
  const platform = PLATFORMS[FORMATS[input.formatId].platform].label
  if (!spec) {
    return [
      {
        id: 'media',
        level: 'error',
        label: 'Media',
        message: `${FORMATS[input.formatId].label}s cannot go out as a ${MEDIA_FORMAT_LABELS.carousel.toLowerCase()}.`
      }
    ]
  }
  // Not loaded yet: nothing to judge.
  if (input.slides === null) {
    return [
      {
        id: 'media',
        level: 'info',
        label: 'Slides',
        message: 'Loading the slides…'
      }
    ]
  }
  const slides = input.slides
  if (slides.length === 0) {
    return [
      {
        id: 'media',
        level: 'error',
        label: 'Slides',
        message:
          'No slides yet: make the carousel, or switch the post to a single image.'
      }
    ]
  }
  const checks: PublishCheck[] = []
  const failed = slides.filter(s => s.status === 'failed')
  if (failed.length > 0) {
    checks.push({
      id: 'slides-failed',
      level: 'error',
      label: 'Slides',
      message: `Slide ${failed.map(s => s.position).join(', ')} could not be drawn. Edit or redraw ${failed.length === 1 ? 'it' : 'them'}.`
    })
  }
  if (slides.length < spec.minSlides || slides.length > spec.maxSlides) {
    checks.push({
      id: 'slides-count',
      level: 'error',
      label: 'Slides',
      message: `${plural(slides.length, 'slide')}; a ${platform} carousel takes ${spec.minSlides} to ${spec.maxSlides}.`
    })
  } else {
    checks.push({
      id: 'slides-count',
      level: 'ok',
      label: 'Slides',
      message:
        spec.delivery === 'document'
          ? `${plural(slides.length, 'slide')}, published as a document ${platform} shows page by page.`
          : `${plural(slides.length, 'slide')}, published as one ${platform} post${spec.maxSlides ? ` (up to ${spec.maxSlides})` : ''}.`
    })
  }
  for (const issue of slideLengthIssues(slides)) {
    checks.push({
      id: `slide-${issue.position}-length`,
      level: 'warning',
      label: 'Slides',
      message: issue.message
    })
  }
  if (captionOnSlides(caption, slides) > CAPTION_COPY_LIMIT) {
    checks.push({
      id: 'slides-caption',
      level: 'warning',
      label: 'Slides',
      message:
        'The slides repeat most of the caption. Keep the points on the slides and the context in the caption.'
    })
  }
  return checks
}

/** Whether any check stops the post from going out. */
export const hasBlockingCheck = (checks: PublishCheck[]) =>
  checks.some(c => c.level === 'error')
