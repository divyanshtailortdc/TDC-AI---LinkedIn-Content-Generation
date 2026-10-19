import type { SamplePost, VoiceConfig } from '@/db/schema'

/**
 * The data behind the writing checks: every phrase list and every threshold,
 * in one place, so tuning a rule never means editing the checking code in
 * writing-checks.ts. The lists are English; a post in another language is not
 * flagged by them.
 */

/** Findings the writing checks can report; also the names `skip` takes. */
export type WritingCheck =
  | 'contrast_overuse'
  | 'dash_overuse'
  | 'vague_attribution'
  | 'sweeping_claim'
  | 'unverified_experience'
  | 'meta_statement'
  | 'filler_phrase'
  | 'copied_source_text'
  | 'repeated_cta'

export interface WritingThresholds {
  /** "It's not X, it's Y" turns allowed in one post; more is a template. */
  contrastFrames: number
  /** Em dashes allowed in one post. */
  emDashes: number
  /** Words in a row shared with a source that mean a sentence was lifted. */
  copiedRunWords: number
  /** Similarity, 0 to 1, at which two closing asks read as the same ask. */
  sameCtaSimilarity: number
}

export const DEFAULT_WRITING_THRESHOLDS: WritingThresholds = {
  contrastFrames: 2,
  emDashes: 3,
  copiedRunWords: 8,
  sameCtaSimilarity: 0.7
}

/** Settings for one account's checks; every part is optional. */
export interface WritingSettings {
  thresholds?: Partial<WritingThresholds>
  /** Checks to leave out, for an author whose voice makes them natural. */
  skip?: WritingCheck[]
  /**
   * The author's own posts. A phrase they already write is theirs: it is not
   * flagged, and em dashes are not counted against an author who uses them.
   */
  authorText?: string | null
}

// ---------------------------------------------------------------------------
// Phrase lists
// ---------------------------------------------------------------------------

/** A negation answered by a correction: "It's not X. It's Y." */
export const CONTRAST_FRAME_PATTERNS: RegExp[] = [
  /\b(?:it|this|that|they|these|those)(?:'s|’s|\s+is|'re|’re|\s+are)\s+not\s+[^.?!\n]{1,80}?[.,;:]\s*(?:it|this|that|they)(?:'s|’s|\s+is|'re|’re|\s+are)\b/gi,
  /\b(?:it|this|that)\s+(?:isn't|isn’t|wasn't|wasn’t)\s+[^.?!\n]{1,80}?[.,;:]\s*(?:it|this|that)(?:'s|’s|\s+is|\s+was)\b/gi,
  // "The pilot doesn't fail. It idles." A first-person subject ("I don't know.
  // It depends.") is an author speaking, not the template.
  /^\s*(?!(?:I|we|you)\b)[^.?!\n]{1,60}\s(?:doesn't|doesn’t|don't|don’t|didn't|didn’t)\s+[^.?!\n]{1,60}\.\s*(?:it|they|he|she)\s+\w+/i,
  /\bnot\s+(?:just\s+|only\s+|about\s+)?[^.?!\n,]{1,50},?\s+but\s+(?:also\s+)?[^.?!\n]{1,50}/gi
]

/** A source named only as "a recent post": the reader cannot check it. */
export const VAGUE_ATTRIBUTION_PATTERNS: RegExp[] = [
  /\b(?:one|another|a)\s+(?:recent|new|new-ish|latest)\s+(?:post|article|piece|report|study|survey|analysis|thread|paper)\b(?!\s+(?:from|by|in|on)\s+[A-Z])/i,
  /\b(?:studies|research|surveys|reports|experts|analysts|sources)\s+(?:shows?|says?|suggests?|indicates?|agree|claims?)\b/i,
  /\b(?:some|many)\s+(?:experts|analysts|studies|reports)\b/i,
  /\b(?:guidance|commentary|coverage)\s+(?:for|on|about)\s+[^.?!\n]{1,40}\s+is\s+(?:blunt|clear|unanimous)\b/i,
  /\baccording\s+to\s+(?:some|one|a|recent)\s+(?:reports?|sources?|studies|posts?)\b/i
]

/**
 * Claims about "most teams" or "everyone" that nothing in the brief measures.
 * Absolutes such as "always fails" live in findUnsupportedAbsolutes, which
 * ideation uses too; the two are checked together.
 */
export const SWEEPING_CLAIM_PATTERNS: RegExp[] = [
  /(?<!in\s)\bmost\s+(?:teams|companies|leaders|organi[sz]ations|businesses|people|engineers|founders|marketers)\s+(?:can't|can’t|cannot|don't|don’t|never|fail|struggle|ignore|skip|miss|think|believe|have\s+no)\b/gi,
  /\b(?:everyone|everybody|nobody|no\s+one)\s+(?:knows|talks|checks|measures|does|reads|wants|needs)\b/gi
]

/** First-hand experience stated as fact, which the model cannot know is true. */
export const EXPERIENCE_CLAIM_PATTERNS: RegExp[] = [
  /\b(?:I|we)\s+(?:keep|kept)\s+seeing\b/i,
  /\b(?:I|we)(?:'ve|’ve|\s+have)\s+(?:seen|watched|sat\s+in|worked\s+with|spoken\s+(?:to|with)|talked\s+(?:to|with))\b/i,
  /\b(?:I|we)\s+(?:see|saw|watched)\s+(?:this|the\s+same|it)\b/i,
  /\bin\s+my\s+(?:experience|work|years|career)\b/i,
  /\b(?:clients|customers|founders|leaders|teams)\s+(?:keep\s+)?(?:tell|told|ask|asked|say|said)\s+(?:me|us)\b/i
]

/** Announcing what the post is: "this is not a pitch" reads as the opposite. */
export const META_STATEMENT_PATTERNS: RegExp[] = [
  /\b(?:this|that)\s+(?:is|isn't|isn’t|is\s+not)\s+(?:a|an)\s+(?:sales\s+)?(?:pitch|ad|advert|promotion|plug)\b/i,
  /\bnot\s+(?:a|an)\s+(?:sales\s+)?pitch\b/i,
  /\b(?:i'm|i’m|i\s+am)\s+not\s+(?:selling|pitching)\b/i,
  /\bno\s+pitch\b/i
]

/** Throat-clearing a candid author may well say, so a voice can allow it. */
export const FILLER_PHRASE_PATTERNS: RegExp[] = [
  /\b(?:let\s+me\s+be\s+(?:honest|clear|real)|to\s+be\s+(?:honest|clear|frank))\b/i,
  /\bhere'?s\s+the\s+(?:thing|truth|kicker)\b/i
]

// ---------------------------------------------------------------------------
// Settings from the author's voice
// ---------------------------------------------------------------------------

/**
 * What the account's voice and posts change about the checks:
 * - a candid voice says "to be honest" and "here's the thing" on purpose;
 * - a punchy voice (directness 4-5) leans on short contrasts, so one more is
 *   allowed;
 * - anything the author already writes in their own posts is theirs.
 */
export function writingSettingsForVoice(
  voice: Pick<VoiceConfig, 'tone' | 'directness'> | null | undefined,
  samplePosts: Pick<SamplePost, 'content'>[] = []
): WritingSettings {
  const skip: WritingCheck[] = []
  if (voice?.tone === 'candid') skip.push('filler_phrase')

  const thresholds: Partial<WritingThresholds> = {}
  if ((voice?.directness ?? 3) >= 4) {
    thresholds.contrastFrames = DEFAULT_WRITING_THRESHOLDS.contrastFrames + 1
  }

  const authorText = samplePosts
    .map(s => s.content)
    .filter(Boolean)
    .join('\n')
  return { skip, thresholds, authorText: authorText || null }
}
