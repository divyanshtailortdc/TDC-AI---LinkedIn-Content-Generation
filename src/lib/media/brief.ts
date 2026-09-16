import { generateText, NoObjectGeneratedError, Output } from 'ai'
import { z } from 'zod'
import { getLanguageModel } from '~/lib/ai'
import {
  addUsage,
  EMPTY_USAGE,
  readCallUsage,
  type CallUsage
} from '~/lib/ai/usage'


/**
 * Media briefs are written by the model from the actual post.
 *
 * This replaced ~2,500 lines of keyword matching that hardcoded one customer's
 * domain: it defaulted every topic to "B2B Operational Strategy" and listed
 * "supply chain", "logistics" and "warehouse management" as permanently
 * unrelated concepts, so an account in those fields could never get a relevant
 * image. What survives here is a thin, domain-neutral guard for the things that
 * are wrong regardless of subject: invented brands, real faces, fake numbers,
 * and overlays too dense to read on a phone.
 */

export type VisualType =
  | 'framework'
  | 'comparison'
  | 'process'
  | 'decision_tree'
  | 'conceptual_illustration'
  | 'data_visual'
  | 'quote_card'
  | 'product_visual'
  | 'none'

export interface TextOverlaySpec {
  headline: string
  supportingPoints?: string[]
  footer?: string
}

export interface MediaBrief {
  /** What the post is about, in the post's own words. */
  postTopic: string
  coreThesis: string
  readerTakeaway: string
  /** The single visual idea the image should express. */
  primaryConcept: string
  visualMetaphor: string
  visualType: VisualType
  textOverlay: TextOverlaySpec
  avoidConcepts: string[]
  whyItFits: string
}

export interface EvidenceSource {
  claim: string
  quote?: string
  author?: string
  sourceTitle?: string
  sourceUrl?: string
  isFresh?: boolean
  verified?: boolean
}

// Moved to relevance-label.ts (client-safe, no server env/AI SDK imports).
// Re-exported here so existing server-side importers keep working.
export type { UserFacingRelevanceLevel, UserFacingRelevanceInfo } from './relevance-label'
export { getUserFacingRelevance } from './relevance-label'

export interface BriefGuardResult {
  relevanceScore: number
  isAcceptable: boolean
  issues: string[]
  alignedConcepts: string[]
  explanation: string
}

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
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'are',
  'was', 'were', 'will', 'can', 'not', 'you', 'your', 'about', 'into', 'than',
  'more', 'when', 'what', 'their', 'they', 'them', 'been', 'being', 'most',
  'some', 'just', 'because', 'which', 'would', 'could', 'should', 'there'
])

/**
 * Crude suffix stripping so "accumulate" and "accumulated", or "scoped" and
 * "unscoped", count as the same idea. Without it a perfectly good metaphorical
 * brief scores as unrelated purely on inflection.
 */
function stem(word: string): string {
  let w = word
  if (w.startsWith('un') && w.length > 6) w = w.slice(2)
  for (const suffix of ['ations', 'ation', 'ings', 'ing', 'ies', 'ied', 'ed', 'es', 's', 'ly']) {
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

const MediaBriefSchema = z.object({
  postTopic: z
    .string()
    .describe("The subject of the post, in the post's own vocabulary."),
  coreThesis: z.string().describe('The argument the post makes, in one sentence.'),
  readerTakeaway: z.string().describe('What the reader should do or believe after reading.'),
  primaryConcept: z
    .string()
    .describe(
      'The single visual idea the image expresses. Concrete and specific to this post, never a generic business scene.'
    ),
  visualMetaphor: z
    .string()
    .describe('How that idea is shown: the composition, the elements, the relationship between them.'),
  visualType: z
    .enum([
      'framework',
      'comparison',
      'process',
      'decision_tree',
      'conceptual_illustration',
      'data_visual',
      'quote_card',
      'product_visual'
    ])
    .describe('The form that best carries this particular argument.'),
  textOverlay: z
    .object({
      headline: z
        .string()
        .describe(
          'Aim for 70 characters or fewer so it stays legible on a phone. May be empty for a purely visual image.'
        ),
      supportingPoints: z
        .array(z.string())
        .default([])
        .describe('Up to 3 labels, each around 40 characters or fewer.'),
      footer: z.string().optional().describe('Optional short caption.')
    })
    .describe('Any text rendered inside the image. Keep it sparse.'),
  imagePrompt: z
    .string()
    .describe(
      'The full text-to-image prompt. Describe the composition, style, palette and any text to render. Never ask for logos, brand marks, watermarks or recognisable real people.'
    ),
  altText: z
    .string()
    .describe(
      'Plain description of the image for screen readers, ideally under 300 characters.'
    ),
  whyItFits: z
    .string()
    .describe('One sentence on how this visual carries the post argument.')
})

export interface DeriveMediaBriefInput {
  postText: string
  thesis?: string | null
  hook?: string | null
  evidence?: EvidenceSource[]
  /** The account's configured house style for generated images. */
  styleGuidance?: string
  aspectRatio?: '1:1' | '16:9' | '4:5'
  accountName?: string
}

const clamp = (value: string | undefined, max: number): string => {
  const text = (value || '').trim()
  if (text.length <= max) return text
  // Cut on a word boundary so the trimmed label still reads as language.
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()
}

/** Trims overlay text and alt text to what actually fits, rather than failing. */
function normalizeOverlay(
  overlay: { headline?: string; supportingPoints?: string[]; footer?: string }
): TextOverlaySpec {
  return {
    headline: clamp(overlay?.headline, 70),
    supportingPoints: (overlay?.supportingPoints || [])
      .slice(0, 3)
      .map(p => clamp(p, 40))
      .filter(Boolean),
    footer: overlay?.footer ? clamp(overlay.footer, 40) : undefined
  }
}

export interface DerivedMediaBrief {
  brief: MediaBrief
  imagePrompt: string
  altText: string
}

/**
 * Enforces the rules that hold regardless of subject, and scores how much of
 * the brief's vocabulary actually comes from the post.
 */
export function guardMediaBrief(
  brief: MediaBrief,
  imagePrompt: string,
  postText: string,
  accountName?: string
): BriefGuardResult {
  const issues: string[] = []
  const haystack = `${brief.primaryConcept} ${brief.visualMetaphor} ${imagePrompt} ${brief.textOverlay?.headline || ''}`.toLowerCase()

  // The account may name itself; anyone else's mark may not appear.
  const ownName = (accountName || '').toLowerCase()
  for (const banned of BANNED_VISUAL_ELEMENTS) {
    if (ownName && banned === ownName) continue
    if (haystack.includes(banned)) {
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
  const overlayText = [
    brief.textOverlay?.headline,
    ...(brief.textOverlay?.supportingPoints || []),
    brief.textOverlay?.footer
  ]
    .filter(Boolean)
    .join(' ')

  const overlayFigures = overlayText.match(/\d+(?:\.\d+)?\s*%|[$£€]\s?\d/g) || []
  for (const figure of overlayFigures) {
    if (!postText.includes(figure.trim())) {
      issues.push(
        `Renders a figure ("${figure.trim()}") that does not appear in the post.`
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
    aligned.length >= 4 ? 80 : aligned.length >= 3 ? 72 : aligned.length >= 2 ? 64 : aligned.length >= 1 ? 45 : 20
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

function buildPrompt(input: DeriveMediaBriefInput): string {
  const evidence = (input.evidence || [])
    .slice(0, 6)
    .map(e => `- ${e.claim}`)
    .join('\n')

  return `Design the image that will accompany this LinkedIn post.

THE POST
"""
${input.postText}
"""

${input.thesis ? `THE ARGUMENT: ${input.thesis}\n` : ''}${
    evidence ? `FACTS THE POST RELIES ON:\n${evidence}\n` : ''
  }
The image ships at ${input.aspectRatio || '16:9'} and will be seen mostly on a phone, roughly the width of a thumb.

Requirements:
- The visual must express THIS post's specific argument. A generic office, handshake or glowing network says nothing.
- Any text in the image must be readable at feed size: one short headline, at most three short labels.
- Never render a statistic that is not stated in the post above.
- Never include a company logo, publication mark, watermark, or a recognisable real person.
${input.styleGuidance ? `- House style to follow: ${input.styleGuidance}` : ''}`
}

export interface DeriveMediaBriefResult {
  derived: DerivedMediaBrief | null
  guard: BriefGuardResult | null
  /** Every call made, including a failed one and the corrective retry. */
  usage: CallUsage
}

/** Asks the model to design the visual, then runs the guard over its answer. */
export async function deriveMediaBrief(
  input: DeriveMediaBriefInput
): Promise<DeriveMediaBriefResult> {
  const handle = getLanguageModel('media_brief')
  if (!handle) return { derived: null, guard: null, usage: EMPTY_USAGE }

  let usage: CallUsage = EMPTY_USAGE

  const attempt = async (extraInstruction?: string) => {
    try {
      const result = await generateText({
        model: handle.model,
        providerOptions: handle.providerOptions,
        instructions:
          'You are an art director for professional social content. You design one image per post, and the image always argues the post\'s specific point rather than decorating it.',
        prompt: extraInstruction
          ? `${buildPrompt(input)}\n\nYour previous attempt was rejected:\n${extraInstruction}\nProduce a different concept that resolves this.`
          : buildPrompt(input),
        output: Output.object({ schema: MediaBriefSchema })
      })
      usage = addUsage(usage, readCallUsage(result, handle.modelId))
      return result.output
    } catch (err) {
      // The tokens were generated and billed before validation rejected them.
      if (NoObjectGeneratedError.isInstance(err)) {
        usage = addUsage(usage, readCallUsage({ usage: err.usage }, handle.modelId))
      }
      throw err
    }
  }

  try {
    let output = await attempt()
    if (!output) return { derived: null, guard: null, usage }

    let brief: MediaBrief = {
      postTopic: output.postTopic,
      coreThesis: output.coreThesis,
      readerTakeaway: output.readerTakeaway,
      primaryConcept: output.primaryConcept,
      visualMetaphor: output.visualMetaphor,
      visualType: output.visualType,
      textOverlay: normalizeOverlay(output.textOverlay),
      avoidConcepts: [],
      whyItFits: output.whyItFits
    }
    let guard = guardMediaBrief(
      brief,
      output.imagePrompt,
      input.postText,
      input.accountName
    )

    // One corrective pass. Beyond that the cost outweighs the benefit.
    if (!guard.isAcceptable) {
      const retry = await attempt(guard.issues.join(' '))
      if (retry) {
        const retryBrief: MediaBrief = {
          postTopic: retry.postTopic,
          coreThesis: retry.coreThesis,
          readerTakeaway: retry.readerTakeaway,
          primaryConcept: retry.primaryConcept,
          visualMetaphor: retry.visualMetaphor,
          visualType: retry.visualType,
          textOverlay: normalizeOverlay(retry.textOverlay),
          avoidConcepts: [brief.primaryConcept],
          whyItFits: retry.whyItFits
        }
        const retryGuard = guardMediaBrief(
          retryBrief,
          retry.imagePrompt,
          input.postText,
          input.accountName
        )
        if (retryGuard.relevanceScore > guard.relevanceScore) {
          output = retry
          brief = retryBrief
          guard = retryGuard
        }
      }
    }

    return {
      derived: {
        brief,
        imagePrompt: output.imagePrompt,
        altText: clamp(output.altText, 300)
      },
      guard,
      usage
    }
  } catch (err) {
    console.warn('Media brief generation failed:', err)
    return { derived: null, guard: null, usage }
  }
}

