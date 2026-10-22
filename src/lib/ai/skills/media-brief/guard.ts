import { HEADLINE_MAX_WORDS } from '@/lib/brand/theme'
import { extractNumbers, mentionsFigure } from '../ideation/guard'
import type { BriefGuardResult, MediaBrief, TextOverlaySpec } from './schema'

/**
 * Things that are wrong in a business visual whatever the subject: someone
 * else's brand mark, a stock-library watermark, or a real person's face.
 */
const BANNED_VISUAL_ELEMENTS = [
  'forbes',
  'harvard business review',
  'bloomberg',
  'techcrunch',
  'wall street journal',
  'reuters',
  'mckinsey',
  'gartner',
  'fast company',
  'the economist',
  'getty',
  'shutterstock',
  'istock',
  'watermark',
  'stock photo watermark'
]

const BANNED_LIKENESSES = [
  'einstein',
  'steve jobs',
  'elon musk',
  'oppenheimer',
  'sun tzu',
  'aristotle',
  'socrates',
  'nietzsche',
  'churchill',
  'lincoln',
  'marcus aurelius',
  'gandhi'
]

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'this',
  'with',
  'from',
  'have',
  'has',
  'are',
  'was',
  'were',
  'will',
  'can',
  'not',
  'you',
  'your',
  'about',
  'into',
  'than',
  'more',
  'when',
  'what',
  'their',
  'they',
  'them',
  'been',
  'being',
  'most',
  'some',
  'just',
  'because',
  'which',
  'would',
  'could',
  'should',
  'there'
])

/**
 * Crude suffix stripping so "accumulate" and "accumulated", or "scoped" and
 * "unscoped", count as the same idea. Without it a perfectly good metaphorical
 * brief scores as unrelated purely on inflection.
 */
function stem(word: string): string {
  let w = word
  if (w.startsWith('un') && w.length > 6) w = w.slice(2)
  for (const suffix of [
    'ations',
    'ation',
    'ings',
    'ing',
    'ies',
    'ied',
    'ed',
    'es',
    's',
    'ly'
  ]) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      return w.slice(0, w.length - suffix.length)
    }
  }
  return w
}

function contentWords(text: string): Set<string> {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
      .map(stem)
  )
}

export const clamp = (value: string | undefined, max: number): string => {
  const text = (value || '').trim()
  if (text.length <= max) return text
  // Cut on a word boundary so the trimmed label still reads as language.
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()
}

/** Trims overlay text and alt text to what actually fits, rather than failing. */
export function normalizeOverlay(overlay: {
  headline?: string
  supportingPoints?: string[]
  footer?: string
}): TextOverlaySpec {
  return {
    headline: clamp(overlay?.headline, 70),
    supportingPoints: (overlay?.supportingPoints || [])
      .slice(0, 3)
      .map(p => clamp(p, 40))
      .filter(Boolean),
    footer: overlay?.footer ? clamp(overlay.footer, 40) : undefined
  }
}

/**
 * True when `term` appears other than as something to leave out. The brief's
 * own instructions tell the model never to ask for watermarks or logos, so its
 * prompts routinely end "no logos, no watermarks"; counting that as a request
 * failed sound briefs and paid for a retry.
 */
function mentionsAffirmatively(text: string, term: string): boolean {
  let from = 0
  for (;;) {
    const at = text.indexOf(term, from)
    if (at === -1) return false
    const clause = text.slice(0, at).split(/[.;:!?\n]/).pop() || ''
    if (!/\b(?:no|not|without|never|avoid|free of|excluding)\b/.test(clause.slice(-60))) {
      return true
    }
    from = at + term.length
  }
}

export interface BriefGuardOptions {
  /** Visual types of the earlier images, newest first. */
  previousVisualTypes?: string[]
  /** The visual types the reviewer allowed; any when unset. */
  allowedTypes?: readonly string[]
  /** Text whose figures the image may also quote, such as the goal's message. */
  extraSourceText?: string
}

/**
 * Enforces the rules that hold regardless of subject, and scores how much of
 * the brief's vocabulary actually comes from the post.
 */
export function guardMediaBrief(
  brief: MediaBrief,
  imagePrompt: string,
  postText: string,
  accountName?: string,
  options: BriefGuardOptions = {}
): BriefGuardResult {
  const issues: string[] = []
  const haystack =
    `${brief.primaryConcept} ${brief.visualMetaphor} ${imagePrompt} ${brief.textOverlay?.headline || ''}`.toLowerCase()

  // The real logo is composited by code; one the model draws is always wrong.
  for (const mark of ['logo', 'wordmark', 'brand mark']) {
    if (mentionsAffirmatively(imagePrompt.toLowerCase(), mark)) {
      issues.push(`Asks the image model to draw a ${mark}; the real one is added afterwards.`)
      break
    }
  }

  const headlineWords = (brief.textOverlay?.headline || '').trim().split(/\s+/).filter(Boolean)
  if (headlineWords.length > HEADLINE_MAX_WORDS) {
    issues.push(`Headline is longer than ${HEADLINE_MAX_WORDS} words.`)
  }

  const lastType = options.previousVisualTypes?.[0]
  if (lastType && brief.visualType === lastType) {
    issues.push(
      `Uses the same visual form (${lastType.replace(/_/g, ' ')}) as the image it replaces.`
    )
  }

  const allowed = options.allowedTypes
  if (allowed?.length && !allowed.includes(brief.visualType)) {
    issues.push(
      `Uses ${brief.visualType.replace(/_/g, ' ')} as its visual, but the reviewer asked for ${allowed.map(t => t.replace(/_/g, ' ')).join(' or ')}.`
    )
  }

  // The account may name itself; anyone else's mark may not appear.
  const ownName = (accountName || '').toLowerCase()
  for (const banned of BANNED_VISUAL_ELEMENTS) {
    if (ownName && banned === ownName) continue
    if (mentionsAffirmatively(haystack, banned)) {
      issues.push(`References a third-party brand or watermark: "${banned}".`)
    }
  }

  for (const person of BANNED_LIKENESSES) {
    if (haystack.includes(person) && !postText.toLowerCase().includes(person)) {
      issues.push(
        `Introduces a real person ("${person}") the post never mentions.`
      )
    }
  }

  // Numbers rendered into an image are the hardest kind to retract.
  // A reference image's blocks too: its own stats are the likeliest to slip in.
  const overlayText = [
    brief.textOverlay?.headline,
    ...(brief.textOverlay?.supportingPoints || []),
    brief.textOverlay?.footer,
    ...(brief.blueprint?.blocks || []).flatMap(b => [b.text, b.detail])
  ]
    .filter(Boolean)
    .join(' ')

  // Whole figures only: a substring test let "5%" pass on a post saying "25%".
  const sourceText = [postText, options.extraSourceText].filter(Boolean).join('\n')
  const postFigures = new Set(extractNumbers(sourceText))
  for (const figure of extractNumbers(overlayText)) {
    if (!postFigures.has(figure) && !mentionsFigure(sourceText, figure)) {
      issues.push(
        `Renders a figure ("${figure}") that does not appear in the post.`
      )
    }
  }

  // A headline nobody can read on a phone is worse than no headline.
  const headline = brief.textOverlay?.headline || ''
  if (headline.length > 70) {
    issues.push('Overlay headline is too long to read at feed size.')
  }
  if ((brief.textOverlay?.supportingPoints || []).length > 3) {
    issues.push('Too many overlay labels for a mobile feed image.')
  }

  // Does the concept actually come from this post?
  const postWords = contentWords(postText)
  const conceptWords = contentWords(
    `${brief.primaryConcept} ${brief.visualMetaphor}`
  )
  const aligned = [...conceptWords].filter(w => postWords.has(w))
  const coverage =
    conceptWords.size === 0 ? 0 : aligned.length / conceptWords.size

  // A concept can be a valid metaphor without reusing the post's nouns, so the
  // absolute number of shared ideas sets a floor under the ratio.
  const floor =
    aligned.length >= 4
      ? 80
      : aligned.length >= 3
        ? 72
        : aligned.length >= 2
          ? 64
          : aligned.length >= 1
            ? 45
            : 20
  let relevanceScore = Math.max(Math.round(coverage * 100), floor)
  if (issues.length > 0) relevanceScore = Math.min(relevanceScore, 55)

  return {
    relevanceScore,
    isAcceptable: issues.length === 0 && relevanceScore >= 60,
    issues,
    alignedConcepts: aligned.slice(0, 12),
    explanation:
      issues.length > 0
        ? issues.join(' ')
        : `Visual concept shares ${aligned.length} key term${aligned.length === 1 ? '' : 's'} with the post.`
  }
}
