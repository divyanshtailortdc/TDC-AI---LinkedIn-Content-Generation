import type { BlogKind, BlogLength } from './types'

/**
 * What makes a blog post a blog post and an article an article, in one
 * place: research depth, the outline, the voice register, how much evidence
 * each section carries, the pictures, and what the checks expect. Research,
 * planning, writing and the checks all read it, so the two kinds differ the
 * same way at every step. Pure.
 *
 * The identity's voice is the author's and wins on person and formality: a
 * profile works inside it (renderKindRules). "I" stays "I" in an article; a
 * strictly formal brand's blog post is still formal, just closer to the
 * reader.
 */

/** How far research may go: model steps, searches, pages read, findings kept. */
export type KindResearchLimits = {
  maxSteps: number
  maxSearches: number
  maxPageReads: number
  maxFindings: number
}

export type KindProfile = {
  /** One line for the new-piece form. */
  summary: string
  /** The register, as rules for the writer (perspective and formality excepted). */
  voice: string[]
  /** How deep each section goes and what the piece must cover. */
  depth: string[]
  /** How much evidence the sections carry. */
  evidence: string[]
  /** Paragraph and sentence shape. */
  shape: string[]
  research: KindResearchLimits
  /** Supporting pictures by length: [fewest, most]. */
  pictures: Record<BlogLength, [number, number]>
  /** The picture style the planner leans to. */
  pictureStyle: string
  /** What the voice-fit check expects. */
  checks: {
    /** Average words per sentence above this reads as heavy (blog). */
    maxAverageSentenceWords: number | null
    /** Share of sentences addressing the reader below this reads distant (blog, formality ≤ 3). */
    minReaderAddressShare: number | null
    /** Every main section carries a source-backed sentence when sources exist (article). */
    sourcePerSection: boolean
    /** Paragraphs averaging fewer sentences than this read choppy (article). */
    minSentencesPerParagraph: number | null
  }
}

export const KIND_PROFILES: Record<BlogKind, KindProfile> = {
  blog: {
    summary: 'Conversational and practical',
    voice: [
      'Conversational: talk to one capable reader. Address them as "you" and write the way the author would explain it across a table.',
      'Plain words over jargon; when a technical term is needed, say what it means in the same sentence.',
      'Open on the reader\'s situation: a moment they will recognise, a problem they have, or a figure that matters to them. One rhetorical question at most in the whole piece.',
      'Show the author\'s stance where they have one, without claiming experience the details do not give.'
    ],
    depth: [
      'Each section gives the reader something to use: a step, an example, a decision rule or a trade-off.',
      'Cover what this reader needs to act; leave out background they do not need.'
    ],
    evidence: [
      'Link a source wherever a fact comes from one; a section of practical advice may rest on reasoning and the author\'s details.'
    ],
    shape: [
      'Paragraphs of 2-4 sentences; most sentences under 20 words, with some longer ones for rhythm.',
      'A section heading every 150-300 words; lists only where the content really is a list or steps.'
    ],
    research: { maxSteps: 12, maxSearches: 8, maxPageReads: 6, maxFindings: 16 },
    pictures: { short: [0, 1], medium: [1, 2], long: [2, 3] },
    pictureStyle: 'a photo or an illustration, whichever suits the subject',
    checks: {
      maxAverageSentenceWords: 22,
      minReaderAddressShare: 0.03,
      sourcePerSection: false,
      minSentencesPerParagraph: null
    }
  },
  article: {
    summary: 'Authoritative and in-depth, with more sources',
    voice: [
      'Authoritative: the measured voice of someone who knows the field. Precise terms, each defined at first use; claims sized to their evidence.',
      'No rhetorical-question openings, no hype, no exclamation marks.',
      'Open on the most important finding, fact or claim, stated plainly.'
    ],
    depth: [
      'In depth: give the context and background a reader needs to judge the subject, then the substance.',
      'Name the trade-offs and the conditions where a conclusion does not hold. Take on the strongest counter-argument fairly.',
      'Say where the evidence is thin, dated or disputed, and what is not known, about the subject itself ("no published study measures…", "the latest national figures are from 2019"), never about your own research ("the sources we use", "the pages we rely on").',
      'Each section advances one point of the argument and follows from the one before it.'
    ],
    evidence: [
      'Every main section carries at least one point backed by a linked source, when the sources allow it.',
      'Where an authoritative source says something better than a paraphrase could, quote it word for word (one or two quotes in the piece), naming who said it.'
    ],
    shape: [
      'Paragraphs of 3-6 sentences that develop one idea each.',
      'Lists only for real steps or enumerations, at most two in the whole piece.'
    ],
    research: { maxSteps: 14, maxSearches: 10, maxPageReads: 8, maxFindings: 20 },
    pictures: { short: [0, 1], medium: [1, 2], long: [2, 3] },
    pictureStyle: 'an editorial photo, unless the subject cannot be photographed',
    checks: {
      maxAverageSentenceWords: null,
      minReaderAddressShare: null,
      sourcePerSection: true,
      minSentencesPerParagraph: 2
    }
  }
}

/** The voice settings a profile defers to; null when the voice was never analysed. */
export type VoiceRegister = { perspective: string; formality: number } | null

/**
 * The person and formality rules: the voice's, always. A blog uses
 * contractions only when the voice is not formal; an article sits one step
 * above the voice's formality and is never casual.
 */
export function registerRules(kind: BlogKind, voice: VoiceRegister): string[] {
  const perspective = voice?.perspective?.trim()
  const rules = [
    perspective
      ? `Write as "${perspective}", the author's own perspective, throughout; addressing the reader as "you" fits it. Never switch to another person.`
      : 'Write as the author speaking for themselves or their company, consistently.'
  ]
  const formality = voice?.formality ?? 3
  if (kind === 'blog') {
    rules.push(
      formality <= 3
        ? 'Contractions are fine ("you\'ll", "it\'s").'
        : 'The voice is formal: keep the warmth in directness and "you", not in slang or contractions.'
    )
  } else {
    rules.push(
      formality >= 4
        ? 'Keep the voice\'s formality.'
        : 'Slightly more formal than the author\'s social posts, never casual: no slang, few contractions, but the author\'s own idiom and stance.'
    )
  }
  return rules
}

/** The kind's rules as the writer reads them, inside the author's voice. */
export function renderKindRules(kind: BlogKind, voice: VoiceRegister): string {
  const profile = KIND_PROFILES[kind]
  return [
    ...registerRules(kind, voice),
    ...profile.voice,
    ...profile.depth,
    ...profile.evidence,
    ...profile.shape
  ]
    .map(rule => `- ${rule}`)
    .join('\n')
}

/** How many supporting pictures a piece of this kind and length gets, as words. */
export function pictureRange(kind: BlogKind, length: BlogLength): string {
  const [low, high] = KIND_PROFILES[kind].pictures[length]
  return low === high ? `${low}` : `${low}-${high}`
}
