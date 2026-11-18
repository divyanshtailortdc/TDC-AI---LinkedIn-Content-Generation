import { extractNumbers, mentionsFigure } from '~/lib/ai/skills/ideation/guard'
import { SLIDE_TEXT, slideText, type SlideContent } from './types'

/**
 * Checks on a carousel's text, shared by the slide writer's guard, the review
 * screen's checks and publishing. Pure.
 */

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|‍|️/gu
const URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi
const HASHTAG = /(^|\s)#([\p{L}\p{N}_]+)/gu

/**
 * A slide's words as they can be drawn: no emoji (the slide fonts have none,
 * and the renderer would show empty boxes), no links (nothing on an image is
 * clickable; the website sits in the footer), no hashtags (they belong in
 * the caption) and no markdown.
 */
export function cleanSlideText(
  text: string | null | undefined,
  multiline = false
): string {
  if (!text) return ''
  const cleaned = text
    .replace(EMOJI, '')
    .replace(URL, '')
    // "#finance teams" reads on as "finance teams".
    .replace(HASHTAG, '$1$2')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
  const lines = cleaned.split('\n').map(line => line.trim())
  return (
    multiline
      ? lines.filter(Boolean).join('\n')
      : lines.filter(Boolean).join(' ')
  ).trim()
}

/** Cut at a word boundary to at most `max` characters, with an ellipsis when cut. */
export function clampWords(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`
}

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** The caption's sentences worth comparing: long enough to be its own wording. */
function sentencesOf(text: string): string[][] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(words)
    .filter(w => w.length >= 6)
}

const shingles = (w: string[], n = 4) => {
  const out = new Set<string>()
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '))
  return out
}

/**
 * How much of the caption is written out on the slides: the share of its
 * sentences (of six words or more) most of whose four-word runs appear on a
 * slide. 0 when the slides only share the odd phrase; near 1 when the
 * caption was pasted onto them.
 */
export function captionOnSlides(
  caption: string,
  slides: Array<Pick<SlideContent, 'headline' | 'body'>>
): number {
  const sentences = sentencesOf(caption)
  if (sentences.length === 0) return 0
  const onSlides = shingles(words(slides.map(slideText).join('\n')))
  if (onSlides.size === 0) return 0
  const copied = sentences.filter(sentence => {
    const own = [...shingles(sentence)]
    if (own.length === 0) return false
    const found = own.filter(s => onSlides.has(s)).length
    return found / own.length >= 0.6
  })
  return copied.length / sentences.length
}

/** Above this share of the caption on the slides, the caption was pasted onto them. */
export const CAPTION_COPY_LIMIT = 0.5

/** The figures in a text: "43%", "1,200", "$4.5m", "3x". */
export function figuresIn(text: string): string[] {
  return (text.match(/\d[\d,.]*/g) ?? []).map(f =>
    f.replace(/[,.]$/, '').replace(/,/g, '')
  )
}

/**
 * Whether every figure in `stat` appears in `sources` (the idea's evidence
 * and the author's details), as the truth rules require.
 */
export function figureIsSourced(stat: string, sources: string): boolean {
  const own = figuresIn(stat)
  if (own.length === 0) return false
  const known = new Set(figuresIn(sources))
  return own.every(f => known.has(f))
}

/**
 * Whether a pull quote is in `sources` word for word, ignoring case,
 * punctuation and quotation marks. An ellipsis may join parts of it; each
 * part must be there.
 */
export function quoteIsSourced(quote: string, sources: string): boolean {
  const said = ` ${words(sources).join(' ')} `
  const parts = quote
    .split(/…|\.{3}/)
    .map(part => words(part).join(' '))
    .filter(Boolean)
  return parts.length > 0 && parts.every(part => said.includes(` ${part} `))
}

/**
 * What a slide states that `sources` (the idea's evidence and the author's
 * details) does not: figures in its headline and text, read as the post's
 * own checks read them ("40%", "forty percent", "$2m"), and a pull quote no
 * source says. The stat is checked where it is drawn (figureIsSourced).
 */
export function slideFactIssues(
  slide: Pick<SlideContent, 'headline' | 'body' | 'design'>,
  sources: string
): string[] {
  const issues: string[] = []
  const known = new Set(extractNumbers(sources))
  const said = sources.toLowerCase()
  const invented = extractNumbers(`${slide.headline}\n${slide.body}`).filter(
    n => !known.has(n) && !mentionsFigure(said, n)
  )
  if (invented.length > 0) {
    issues.push(
      `${invented.map(n => `"${n}"`).join(', ')} ${invented.length === 1 ? 'is' : 'are'} not in the post's evidence or the author's details. Use a figure from the evidence, or remove it.`
    )
  }
  if (
    slide.design.layout === 'quote' &&
    slide.body.trim() &&
    !quoteIsSourced(slide.body, sources)
  ) {
    issues.push(
      "The quote is not in the post's evidence. Quote a source word for word, or use another layout."
    )
  }
  return issues
}

export interface SlideTextIssue {
  position: number
  message: string
}

/** Slides whose words run past what can be read while swiping. */
export function slideLengthIssues(
  slides: Array<Pick<SlideContent, 'headline' | 'body'> & { position: number }>
): SlideTextIssue[] {
  const issues: SlideTextIssue[] = []
  for (const slide of slides) {
    if (!slide.headline.trim()) {
      issues.push({
        position: slide.position,
        message: `Slide ${slide.position} has no headline.`
      })
    } else if (slide.headline.length > SLIDE_TEXT.headline.soft) {
      issues.push({
        position: slide.position,
        message: `Slide ${slide.position}'s headline is ${slide.headline.length} characters; under ${SLIDE_TEXT.headline.soft} reads at a glance.`
      })
    }
    if (slide.body.length > SLIDE_TEXT.body.soft) {
      issues.push({
        position: slide.position,
        message: `Slide ${slide.position}'s text is ${slide.body.length} characters; under ${SLIDE_TEXT.body.soft} reads while swiping.`
      })
    }
  }
  return issues
}
