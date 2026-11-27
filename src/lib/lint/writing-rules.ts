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
  // Checked for posts written from uploaded media (media-post/quality.ts),
  // not by runLinter.
  | 'promotional_language'
  | 'repeated_wording'
  | 'retold_sequence'
  | 'media_narration'
  | 'feature_sheet'
  | 'repeated_message'

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

/**
 * Words and phrases that mark long-form text as machine-written: the
 * vocabulary of generic AI prose, which says nothing a reader can use. A few
 * are fine in a long piece (the check allows some in proportion to length)
 * and none is flagged when the author's own posts use it.
 */
export const GENERIC_PHRASE_PATTERNS: RegExp[] = [
  /\bdelv(?:e|es|ed|ing)\b/i,
  /\b(?:ever|constantly|rapidly)[-\s](?:evolving|changing)\s+(?:landscape|world|world of)\b/i,
  /\bin\s+today'?s\s+(?:fast[-\s]paced|digital|modern|ever[-\s]changing|competitive)\b/i,
  /\bnavigat(?:e|es|ing)\s+(?:the\s+)?(?:complexities|intricacies|challenges|landscape|maze)\b/i,
  /\bunlock(?:s|ing)?\s+(?:the\s+)?(?:full\s+)?(?:power|potential|secrets?)\b/i,
  /\bharness(?:es|ing)?\s+the\s+power\b/i,
  /\bgame[-\s]?changer\b/i,
  /\bseamless(?:ly)?\b/i,
  /\btapestry\b/i,
  /\b(?:in|into)\s+the\s+realm\s+of\b/i,
  /\bembark(?:s|ed|ing)?\s+on\b/i,
  /\belevate\s+your\b/i,
  /\bit'?s\s+(?:important|worth|crucial|essential)\s+to\s+(?:note|remember|mention)\b/i,
  /\bwhether\s+you'?re\s+an?\s+[^.?!,]{1,40}\s+or\s+an?\s+/i,
  /\blook\s+no\s+further\b/i,
  /\bin\s+conclusion\b/i,
  /\bat\s+the\s+end\s+of\s+the\s+day\b/i,
  /\bthe\s+world\s+of\s+\w+\s+is\b/i,
  /\b(?:a|the)\s+testament\s+to\b/i,
  /\bplays?\s+a\s+(?:crucial|pivotal|vital|key)\s+role\b/i,
  /\bcutting[-\s]edge\b/i,
  /\brevolutioniz(?:e|es|ed|ing)\b/i,
  /\bparadigm\s+shift\b/i,
  /\bsynerg(?:y|ies)\b/i,
  /\bholistic\s+approach\b/i,
  /\bmyriad\s+of\b/i,
  /\bbustling\b/i,
  /\bfostering\b/i,
  /\bunderscore(?:s|d)?\s+the\s+importance\b/i,
  // Writing about its own research instead of the subject.
  /\b(?:the|our|my)\s+(?:sources|pages|references)\s+(?:we|i)\s+(?:use|used|rely\s+on|relied\s+on|draw\s+on|drew\s+on|cite|have)\b/i,
  /\b(?:the|our)\s+sources\s+(?:provided|available|given)\b/i
]

/**
 * Sentences about the research or the writing instead of the subject: a
 * live article told its readers which sources it "saw only as a search
 * snippet", that a quotation "is cut off", and that "we skip a chart here".
 * A reader wants the subject; what could not be supported is left out.
 */
export const RESEARCH_NARRATION_PATTERNS: RegExp[] = [
  /\bsearch\s+snippets?\b/i,
  /\b(?:seen|saw|available|visible)\s+only\s+(?:as|in)\s+(?:a|an|the)\s+(?:search\s+)?(?:snippet|abstract|excerpt|preview)\b/i,
  /\b(?:we|i)\s+(?:saw|read|had|have)\s+only\s+(?:the|an?)\s+(?:abstract|snippet|excerpt|headline|preview)\b/i,
  /\bno\s+(?:source|study|data|figure|evidence|report)\s+(?:that\s+)?(?:we|i)\s+(?:can|could)\s+(?:cite|point\s+to|find|use|check)\b/i,
  /\b(?:material|sources?|evidence|pages?|data)\s+(?:that\s+)?(?:we|i)\s+(?:can|could)\s+(?:cite|point\s+to|see|access)\b/i,
  /\b(?:is|are|was|were)\s+not\s+available\s+to\s+(?:us|me)\b/i,
  /\b(?:we|i)\s+(?:could\s+not|couldn't|couldn’t)\s+(?:find|confirm|verify|locate|access)\b/i,
  /\b(?:quote|quotation|passage|text)\s+is\s+cut\s+off\b/i,
  /\bwe\s+(?:skip|skipped|leave\s+out|left\s+out)\s+(?:a|the)\s+(?:chart|table|diagram|graph)\b/i,
  /\b(?:this|the)\s+(?:section|part|paragraph|rule)\s+is\s+(?:our|my)\s+(?:analysis|judgment|judgement|opinion|view)\b/i,
  /\bnot\s+(?:a\s+)?sourced\s+fact\b/i,
  /\bwe\s+hold\s+(?:that|this|it)\s+as\s+(?:an\s+)?opinion\b/i,
  /\bwe\s+use\s+only\s+what\s+(?:is|was)\s+shown\b/i
]

/**
 * Marking a judgment as the author's. Right for a contested call; stacked on
 * every judgment it reads as nerves, not care (a live article had six).
 */
export const VIEW_QUALIFIER_PATTERN =
  /\b(?:in\s+(?:our|my)\s+(?:view|opinion|judgment|judgement)|(?:we|i)\s+(?:think|believe|suspect|would\s+argue)|(?:this|that)\s+is\s+(?:our|my)\s+(?:judgment|judgement|view|reading)|(?:our|my)\s+(?:reading|judgment|judgement|view|take)\s+(?:is|of)\b)\b/gi

/**
 * Advert language: hype, rankings and urgency a post cannot back up. A
 * product shown working makes the case; these words only claim it. Checked
 * on posts written from uploaded media (media-post/quality.ts), alongside
 * GENERIC_PHRASE_PATTERNS. A phrase the author's own posts or notes use is
 * theirs, and not flagged.
 */
export const PROMOTIONAL_PHRASE_PATTERNS: RegExp[] = [
  /\b(?:world|best|first)[-\s]class\b/i,
  /\bindustry[-\s]leading\b/i,
  /\bstate[-\s]of[-\s]the[-\s]art\b/i,
  /\b(?:to\s+the\s+)?next[-\s]level\b/i,
  /\bgame[-\s]?chang(?:er|ers|ing)\b/i,
  /\b(?:revolutionary|groundbreaking|unparalleled|unmatched|unbeatable)\b/i,
  /\bmust[-\s]have\b/i,
  /\b(?:don't|don’t|do\s+not)\s+miss\s+(?:out|this|it)\b/i,
  // An order to act now, opening a sentence: not "their order now shows"
  // nor "buy now, pay later".
  /(?<=^|[.!?:;]\s+|\n\s*)(?:act|buy|order|shop|sign\s+up|join)\s+now\b(?![\s,–—-]+pay\s+later)/im,
  /\blimited[-\s]time\b/i,
  /\beffortless(?:ly)?\b/i,
  /\blike\s+never\s+before\b/i,
  /\bsay\s+goodbye\s+to\b/i,
  /\bone[-\s]stop[-\s]shop\b/i,
  /\b(?:the\s+)?ultimate\s+(?:solution|tool|platform|guide|way|answer)\b/i,
  /\bthe\s+only\s+(?:tool|platform|solution|app|software|product|way)\b/i,
  /(?:#1|\bnumber\s+one)\s+(?:tool|platform|solution|app|choice)\b/i,
  /\bskyrocket(?:s|ed|ing)?\b/i,
  /\bsupercharg(?:e|es|ed|ing)\b/i,
  /\btransform(?:s|ing)?\s+(?:your|the\s+way)\b/i,
  /\bpowerful\s+(?:new\s+)?(?:tool|platform|solution|features?)\b/i,
  /\bboosts?\s+your\b/i
]

/**
 * A post narrating the media it goes out with instead of talking to the
 * reader: "This video shows…", "In the demo…", "The moment worth watching…".
 * Readers see the media beside the post; the post says what it means for
 * them. Checked on posts written from uploaded media (media-post/quality.ts).
 */
const MEDIA_NOUN =
  '(?:video|clip|demo|walkthrough|walk-through|reel|short|footage|recording)'
export const MEDIA_NARRATION_PATTERNS: RegExp[] = [
  new RegExp(
    `\\b(?:this|the|our|that)\\s+(?:(?:short|quick|new|product|launch)\\s+)?${MEDIA_NOUN}\\s+(?:shows|showed|walks|takes|covers|demonstrates|highlights|features|opens|starts|begins|ends|closes|goes|moves|cuts|explains|presents|follows)\\b`,
    'i'
  ),
  new RegExp(`\\bin\\s+(?:this|the|our)\\s+${MEDIA_NOUN}\\b`, 'i'),
  /\bmoments?\s+worth\s+(?:watching|seeing)\b/i,
  /\bworth\s+watching\s+for\b/i,
  /\bwatch\s+as\b/i,
  /\byou(?:'ll|’ll|\s+will)\s+see\s+(?:how|it)\b/i,
  /\bhere(?:'s|’s|\s+is)\s+a\s+(?:quick\s+)?look\b/i,
  /\b(?:first|next|last|final|opening|closing)\s+(?:frame|scene|shot)\b/i,
  /\b\d+[-\s]second\s+mark\b/i
]

/**
 * A post from a product video written as a feature sheet: "Here's what it
 * does for you:" over a bullet per feature, every control in a row. Checked
 * on posts written from uploaded media (media-post/quality.ts).
 */
export const FEATURE_SHEET_PATTERNS: RegExp[] = [
  /\bhere(?:'s|’s|\s+is|\s+are)\s+(?:what|how)\s+(?:it|you|they|this|that|we)\s+(?:does|do|get|gets|can|offers?|works?)\b/i,
  /\b(?:key|main|core|top|standout)\s+features?\b/i,
  /\bfeatures?\s+(?:include|including)\b/i,
  /\bwhat\s+you\s+get\s*:/i,
  /\b(?:and\s+)?that(?:'s|’s|\s+is)\s+not\s+all\b/i
]

/** How much listing a post from media may do before it reads as a manual. */
export const FEATURE_SHEET_LIMITS = {
  /** Lines one under another starting with a bullet, a number or an emoji. */
  listLines: 3,
  /** Things named in one comma-separated run in a sentence. */
  itemsInSentence: 3
}

/** A line that is a list item: a bullet, a dash, a number or an emoji first. */
export const LIST_LINE_PATTERN =
  /^\s*(?:[•·▪▸►‣◦✓✔➤➜→\-*]|\d{1,2}[.)]|\p{Extended_Pictographic})/u

/**
 * Capabilities a product video is often credited with because products like
 * it have them: integrations, analytics, automation, AI, real-time updates,
 * notifications, apps, named platforms. A post may claim one only when the
 * media's analysis or the author's notes say it too (`evidence`, else the
 * claim's own pattern, tried on them). Checked on posts written from
 * uploaded media.
 */
export const CAPABILITY_CLAIMS: Array<{ claim: RegExp; evidence?: RegExp }> = [
  { claim: /\bintegrat(?:es?|ed|ing|ions?)\b/i },
  {
    claim:
      /\b(?:connects?|syncs?|synchroni[sz]es?|plugs?\s+into)\s+(?:(?:with|to|into)\s+)?(?:your|any|all|every)\b/i,
    evidence: /\b(?:connect|sync|synchroni[sz]|integrat|plug)/i
  },
  { claim: /\banalytics\b/i },
  { claim: /\bdashboards?\b/i },
  { claim: /\breporting\b/i, evidence: /\breport/i },
  { claim: /\binsights?\b/i },
  {
    claim: /\bautomat(?:es?|ed|ing|ically|ion|ions)\b/i,
    evidence: /\bautomat|\bauto[-\s]/i
  },
  { claim: /\bAI\b/, evidence: /\bAI\b|artificial\s+intelligence/i },
  { claim: /\bartificial\s+intelligence\b/i, evidence: /\bAI\b|artificial\s+intelligence/i },
  { claim: /\bmachine\s+learning\b/i },
  { claim: /\breal[-\s]?time\b/i },
  { claim: /\bnotifications?\b/i, evidence: /\bnotif/i },
  { claim: /\b(?:sms|whatsapp)\b/i },
  { claim: /\bAPIs?\b/ },
  { claim: /\bwebhooks?\b/i },
  { claim: /\b(?:mobile|ios|android)\s+apps?\b/i, evidence: /\b(?:mobile|ios|android)\s+app|\bapp\s+store\b/i },
  {
    claim:
      /\b(?:shopify|woocommerce|magento|bigcommerce|wix|squarespace|salesforce|hubspot|zapier|klaviyo|mailchimp)\b/i
  },
  { claim: /\bdrag[-\s]and[-\s]drop\b/i },
  { claim: /\bno[-\s]code\b/i },
  {
    claim: /\bmulti[-\s]?lingual\b|\bin\s+(?:any|multiple|several)\s+languages\b/i,
    evidence: /lingual|languages?\b|translat/i
  },
  { claim: /\bA\/B\s+test/i },
  { claim: /\bone[-\s]click\b/i },
  { claim: /\bunlimited\b/i }
]

/** Words that open a step-by-step retelling: "First…", "Then…", "Finally…". */
export const SEQUENCE_OPENING_PATTERN =
  /^(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|then|next|after\s+that|afterwards|finally|lastly|step\s+\d+|to\s+(?:start|begin)|from\s+there|once\s+(?:that|it)(?:'s|’s|\s+is)\s+done)\b/i

/**
 * Words too common to count as repeated wording: function words, and the
 * words every post uses. Content words are counted only from five letters.
 */
export const REPETITION_STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'along', 'already', 'also',
  'always', 'among', 'another', 'around', 'because', 'before', 'being',
  'below', 'between', 'both', 'cannot', 'could', 'doing', 'during', 'each',
  'either', 'every', 'first', 'from', 'further', 'having', 'here', 'into',
  'itself', 'just', 'least', 'less', 'like', 'many', 'might', 'more', 'most',
  'much', 'must', 'never', 'other', 'others', 'ours', 'over', 'same',
  'should', 'since', 'some', 'still', 'such', 'than', 'that', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'thing',
  'things', 'this', 'those', 'through', 'under', 'until', 'very', 'want',
  'what', 'when', 'where', 'whether', 'which', 'while', 'with', 'within',
  'without', 'would', 'your', 'yours', 'yourself', 'people'
])

/** Sentence openings that do not count as repeating one: articles and "I". */
export const REPETITION_FREE_OPENINGS = new Set(['the', 'a', 'an', 'i', 'we'])

export interface RepetitionLimits {
  /** Uses of one content word allowed, or one per this many words if more. */
  wordUses: number
  wordsPerUse: number
  /** Sentences that may open on the same word. */
  sameOpenings: number
  /** Sentence openings like "First"/"Then" before a post reads as a retelling. */
  sequenceOpenings: number
  /** The media's own captions a post may repeat word for word. */
  retoldCaptions: number
}

export const DEFAULT_REPETITION_LIMITS: RepetitionLimits = {
  wordUses: 4,
  wordsPerUse: 45,
  sameOpenings: 2,
  sequenceOpenings: 2,
  retoldCaptions: 2
}

/** Openings that clear the throat instead of saying something. */
export const GENERIC_OPENING_PATTERNS: RegExp[] = [
  /^in\s+today'?s\b/i,
  /^in\s+the\s+(?:world|realm|age|era)\s+of\b/i,
  /^in\s+an?\s+(?:world|era|age)\s+(?:where|of)\b/i,
  /^are\s+you\s+(?:looking|struggling|tired|wondering|ready)\b/i,
  /^have\s+you\s+ever\s+(?:wondered|thought|asked)\b/i,
  /^imagine\s+(?:a\s+world|this)\b/i,
  /^(?:when\s+it\s+comes\s+to|picture\s+this)\b/i,
  /^[^.?!]{1,60}\s+is\s+defined\s+as\b/i,
  /^according\s+to\s+(?:the\s+)?(?:dictionary|merriam|oxford|webster)\b/i
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
