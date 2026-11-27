import { FORMATS, isCasualStyle } from '@/lib/formats'
import {
  captionOf,
  postTextOf,
  type MediaPostDraft
} from '~/lib/media-upload/drafts'
import { runLinter, wholeTermPattern } from '~/lib/lint/run-linter'
import {
  countListLines,
  countSequenceOpenings,
  findFeatureSheetPhrases,
  findLongLists,
  findMediaNarration,
  findPromotionalPhrases,
  findRepeatedWording,
  findRestatedSentences,
  findRetoldCaptions,
  findUnsupportedCapabilities,
  longestSharedRun
} from '~/lib/lint/writing-checks'
import {
  DEFAULT_REPETITION_LIMITS,
  FEATURE_SHEET_LIMITS,
  REPETITION_STOPWORDS,
  writingSettingsForVoice,
  type WritingCheck
} from '~/lib/lint/writing-rules'
import { recentCtasOf, styleFor, type GenerationContext } from '../../context'
import { buildFormatLintOptions } from '../../pipeline/post-lint'
import {
  collectFigureSources,
  collectLinkSources
} from '../post-drafting/guard'
import { featureGroups, groupsToCover } from './features'
import { ROOMY_TARGET_CHARS } from './prompt'
import type { MediaAnalysis, MediaFeature } from './schema'

/**
 * The checks a post written from uploaded media must pass before the page
 * shows it; a post that fails any is rewritten once (see index.ts). Pure:
 * no model, no database.
 *
 * They are the drafting linter's (invented figures, products, stories and
 * links, banned and cliché words, sweeping claims, the fold, hashtags,
 * emoji), with the media standing in for the evidence, plus what goes wrong
 * when a post is written from a video: retelling it step by step or caption
 * by caption, narrating it ("This video shows…"), advert language, leaning
 * on the same words, naming a demo's sample data, hashtags left in the text,
 * ending without a question, and, where the platform has room, leaving out
 * what the video demonstrates or being too short to carry it. And what makes
 * a post from a product video read like its manual: a bullet per feature,
 * every control named in a row, a list announced ("Here's what it does"),
 * the main message said twice; and capabilities the video never shows.
 */

export interface MediaCheckContext {
  ctx: GenerationContext
  kind: 'image' | 'video'
  analysis: MediaAnalysis
  notes: string
  /**
   * Features the model listed that no frame it named shows (verifiedAnalysis):
   * a post naming one is claiming what the media does not show.
   */
  unverified?: readonly MediaFeature[]
}

/**
 * The linter's warnings that send a post back. Its errors always do; its
 * other warnings (citations, a post near its limit) are not about writing
 * from media.
 */
const FIX_WARNINGS = new Set([
  'hook_fold',
  'link_placement',
  'banned_words',
  'hashtag_count',
  'emoji_policy',
  'cta_required',
  'generic_cta',
  'excessive_caps',
  'contrast_overuse',
  'dash_overuse',
  'vague_attribution',
  'sweeping_claim',
  'unverified_experience',
  'meta_statement',
  'filler_phrase',
  'repeated_cta'
])

/** Hashtags that tell a feed nothing about the post or who it is for. */
const GENERIC_HASHTAGS = new Set([
  'video',
  'videos',
  'post',
  'linkedin',
  'business',
  'success',
  'motivation',
  'inspiration',
  'innovation',
  'trending',
  'viral',
  'new',
  'update',
  'tech',
  'technology'
])

/** Notes long enough to be a script pasted in; shorter ones are facts to use. */
const NOTES_SCRIPT_WORDS = 30
/** Words in a row from such notes that mean the post reads them out. */
const NOTES_COPIED_WORDS = 12

/**
 * Shorter than this, a post from media that demonstrates several groups of
 * features is too short to carry them: the main message alone, or names
 * without what they do. About a hook, the message and the question, and a
 * short paragraph per group, up to this share of the platform's aim. Per
 * group, not per feature: a floor per feature pushed posts into a line per
 * control.
 */
const SHORT_BASE_CHARS = 250
const SHORT_CHARS_PER_GROUP = 120
const SHORT_SHARE = 0.6

/** The fewest characters a roomy post needs to carry this many groups. */
export const shortFloorOf = (targetChars: number, groups: number) =>
  Math.min(
    Math.round(targetChars * SHORT_SHARE),
    SHORT_BASE_CHARS + SHORT_CHARS_PER_GROUP * groups
  )

/** A hashtag written into the text: # and a word with a letter, not a link's #anchor. */
const TAG_IN_TEXT = /(?<![\p{L}\p{N}_&/])#(?=[\p{N}_]*\p{L})[\p{L}\p{N}\p{M}_]+/gu

/** The kinds of media whose features a post is held to. */
const DEMONSTRATING = new Set(['product', 'explainer'])

const lowerWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/**
 * Whether a post's words name a term: a short term as written (or plural),
 * a longer one by its stem, so "banner" finds "banners" and "customise"
 * finds "customisation" and "customize".
 */
function namesTerm(postWords: ReadonlySet<string>, term: string): boolean {
  const parts = lowerWords(term)
  if (parts.length === 0) return false
  return parts.every(part => {
    if (part.length <= 4) return postWords.has(part) || postWords.has(`${part}s`)
    const stem = part.slice(0, Math.max(5, part.length - 2))
    for (const word of postWords) if (word.startsWith(stem)) return true
    return false
  })
}

/** The words a post naming the feature would use: its terms, or failing those its name's. */
function termsOf(feature: MediaFeature): string[] {
  const terms = feature.terms.map(t => t.trim()).filter(Boolean)
  return terms.length > 0
    ? terms
    : lowerWords(feature.name).filter(
        w => w.length >= 4 && !REPETITION_STOPWORDS.has(w)
      )
}

const names = (postWords: ReadonlySet<string>, feature: MediaFeature) =>
  termsOf(feature).some(term => namesTerm(postWords, term))

/**
 * What a post with room leaves out of what the media demonstrates: the lead
 * and supporting features it does not name, strongest group first. Minor
 * ones (a single control, something glimpsed) are never required: naming
 * every control is what made posts read like a manual. Pure.
 */
export function missingFeatures(
  prose: string,
  features: readonly MediaFeature[]
): MediaFeature[] {
  const postWords = new Set(lowerWords(prose))
  return groupsToCover(features).flatMap(group =>
    group.features.filter(f => f.priority !== 'minor' && !names(postWords, f))
  )
}

/** On-screen text long enough to be a caption or title card, not a button or a label. */
const CAPTION_WORDS = 4

/**
 * Whether one of the media's captions names the feature: the video gave it a
 * card of its own, so it is part of what the video says, never minor.
 */
function captioned(feature: MediaFeature, visibleText: readonly string[]): boolean {
  return visibleText.some(text => {
    const words = lowerWords(text)
    return (
      words.length >= CAPTION_WORDS &&
      termsOf(feature).some(term => namesTerm(new Set(words), term))
    )
  })
}

/**
 * The analysis held to the frames the model was shown: each feature keeps
 * only real frame numbers (1 to `frameCount`), and one that no frame shows
 * and the notes do not name is taken out, since it is a guess at what a
 * product like it has. What was taken out is returned too, so a post that
 * names it anyway is caught (mediaPostProblems). A minor feature that one of
 * the media's captions names becomes a supporting one: the model ranked the
 * Track360 video's "Check it on mobile before you publish." card as minor,
 * and the posts dropped it.
 */
export function verifiedAnalysis(
  analysis: MediaAnalysis,
  frameCount: number,
  notes: string
): { analysis: MediaAnalysis; unverified: MediaFeature[] } {
  const noteWords = new Set(lowerWords(notes))
  const kept: MediaFeature[] = []
  const unverified: MediaFeature[] = []
  for (const feature of analysis.message.features) {
    const frames = Array.from(
      new Set(
        feature.frames.filter(
          n => Number.isInteger(n) && n >= 1 && n <= frameCount
        )
      )
    ).sort((a, b) => a - b)
    if (frames.length > 0 || (noteWords.size > 0 && names(noteWords, feature))) {
      // A feature a caption names was given a card of its own: never minor.
      const priority =
        feature.priority === 'minor' && captioned(feature, analysis.visibleText)
          ? 'supporting'
          : feature.priority
      kept.push({ ...feature, frames, priority })
    } else {
      unverified.push(feature)
    }
  }
  return {
    analysis: { ...analysis, message: { ...analysis.message, features: kept } },
    unverified
  }
}

/** What the media is known to show, and the notes say: a capability must be in it. */
function capabilityEvidenceOf(check: MediaCheckContext): string {
  const { analysis } = check
  return [
    analysis.summary,
    ...analysis.details,
    ...analysis.visibleText,
    ...analysis.message.features.flatMap(f => [f.name, f.shown]),
    check.notes
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Unverified features (see verifiedAnalysis) a post names, by the terms that
 * nothing the media is known to show uses.
 */
function namedUnverified(
  prose: string,
  unverified: readonly MediaFeature[],
  evidence: string
): MediaFeature[] {
  const postWords = new Set(lowerWords(prose))
  const evidenceWords = new Set(lowerWords(evidence))
  return unverified.filter(feature =>
    termsOf(feature).some(
      term => namesTerm(postWords, term) && !namesTerm(evidenceWords, term)
    )
  )
}

/** Hashtags written into a post's text, as written, each once. */
export function hashtagsInText(text: string): string[] {
  return Array.from(new Set(text.match(TAG_IN_TEXT) ?? []))
}

/** Everything a figure in the post may come from: the media, the notes, the author. */
function figureSourcesOf(check: MediaCheckContext): string {
  return [
    collectFigureSources(check.ctx, {
      title: '',
      thesis: '',
      hookConcept: '',
      coreArgument: '',
      whyNow: '',
      supportingEvidence: []
    }),
    check.notes,
    ...check.analysis.visibleText,
    ...check.analysis.details
  ]
    .filter(Boolean)
    .join('\n')
}

const quoted = (found: readonly string[]) =>
  found.map(v => `"${v}"`).join(', ')

/** Percentages and prices as written, spaces aside ("15%", "$49"): a demo's sample offer. */
const figuresIn = (text: string) =>
  (text.match(/[$€£₹]\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?%/g) ?? []).map(f =>
    f.replace(/\s+/g, '')
  )

/**
 * The name in a subject ("Track360" in "Track360, a branded tracking
 * page"): words with a capital or a digit. The rest of it is ordinary
 * wording, which a post should not lean on either.
 */
const nameWordsOf = (subject: string) =>
  subject.split(/[^\p{L}\p{N}]+/u).filter(w => /[\p{Lu}\p{N}]/u.test(w))

/**
 * What is wrong with a post written from media, each as an instruction the
 * rewrite can follow. Empty when it passes.
 */
export function mediaPostProblems(
  draft: MediaPostDraft,
  check: MediaCheckContext
): string[] {
  const { ctx, kind, analysis, notes } = check
  const spec = FORMATS[draft.formatId]
  const isShort = spec.structure === 'script'
  const settings = writingSettingsForVoice(ctx.voice, ctx.samplePosts)
  // What the author wrote is theirs: their posts, and the notes they gave.
  const authorText = [settings.authorText, notes].filter(Boolean).join('\n')
  const skipped = new Set<WritingCheck>(settings.skip)
  const stored = postTextOf(draft)
  const base = buildFormatLintOptions(ctx, draft.formatId, null, {
    hook: stored.hook,
    body: stored.body,
    cta: stored.cta,
    hashtags: stored.hashtags,
    firstComment: stored.firstComment,
    payload: stored.payload
  })

  const findings = runLinter({
    ...base,
    // A Short's caption is checked as prose; it is no script to time.
    hook: draft.hook,
    body: draft.body,
    cta: draft.cta.trim() || null,
    video: null,
    // The limits the prompt gave, which the page holds the post to.
    maxChars: spec.limits.maxChars,
    hookMaxChars: spec.limits.foldChars,
    // The media is the evidence: its figures are visible or in the notes.
    figureSources: figureSourcesOf(check),
    linkSources: collectLinkSources(ctx, { supportingEvidence: [] }, [notes]),
    minCitations: 0,
    recentCtas: recentCtasOf(ctx),
    mediaFormat: kind,
    writing: { ...settings, authorText: authorText || null }
  })
  const problems = findings
    .filter(
      f => !f.passed && (f.severity === 'error' || FIX_WARNINGS.has(f.rule))
    )
    .map(f => f.message)

  const prose = [draft.hook, draft.body, draft.cta]
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n\n')
  const authorLower = authorText.toLowerCase()
  const notAuthors = (found: string[]) =>
    found.filter(f => !authorLower.includes(f.toLowerCase()))
  const casual = isCasualStyle(styleFor(ctx, spec.platform))
  const thing = kind === 'video' ? 'video' : 'image'

  if (!skipped.has('promotional_language')) {
    const hype = notAuthors(findPromotionalPhrases(prose))
    if (hype.length > 0) {
      problems.push(
        `${quoted(hype)} reads as an advert. Say plainly what the ${thing} shows it doing for the reader.`
      )
    }
    const exclamations = (prose.match(/!/g) ?? []).length
    if (!casual && exclamations > 1) {
      problems.push(
        `${exclamations} exclamation marks read as an advert. Keep one at most.`
      )
    }
  }

  if (!skipped.has('media_narration')) {
    const narration = notAuthors(findMediaNarration(prose))
    if (narration.length > 0) {
      problems.push(
        `${quoted(narration)} narrates the ${thing}. Readers see it beside the post: talk to them about their business, and say what the ${thing} shows in terms of what it does for them.`
      )
    }
  }

  // What the media demonstrates, where the platform has room for it: the
  // lead demonstrations, and each group of the rest, not every feature.
  const message = analysis.message
  const roomy = spec.limits.targetChars >= ROOMY_TARGET_CHARS && !isShort
  const groups = groupsToCover(message.features)
  if (roomy && DEMONSTRATING.has(message.kind) && groups.length > 0) {
    const missing = missingFeatures(prose, message.features)
    if (missing.length > 0) {
      problems.push(
        `It leaves out what the ${thing} demonstrates: ${missing
          .map(
            f =>
              `${f.name}, ${f.priority === 'lead' ? 'a lead demonstration' : `for "${f.group.trim() || f.name}"`} (${f.benefit.trim().replace(/[.!]+$/, '')})`
          )
          .join('; ')}. Give a lead demonstration a sentence on what it lets the reader do and why that matters to them; a supporting one a clause inside the paragraph it belongs with. Keep what the post already covers, and do not list controls.`
      )
    } else if (groups.length >= 2) {
      const length = prose.length
      const floor = shortFloorOf(spec.limits.targetChars, groups.length)
      if (length < floor) {
        problems.push(
          `At ${length} characters it is too short for what the ${thing} demonstrates. Say why the lead demonstrations matter to the reader, not only what they are (${floor} characters or more, about ${spec.limits.targetChars} at most); never pad.`
        )
      }
    }
  }

  // Never more than the media shows: features the model listed that no
  // frame shows, and capabilities products like it often have.
  const evidence = capabilityEvidenceOf(check)
  const guessed = namedUnverified(prose, check.unverified ?? [], evidence)
  if (guessed.length > 0) {
    problems.push(
      `It names ${quoted(guessed.map(f => f.name))}, which none of the ${thing}'s frames shows. Leave ${guessed.length === 1 ? 'it' : 'them'} out: the post says only what the ${thing} demonstrates.`
    )
  }
  const claimed = findUnsupportedCapabilities(prose, evidence)
  if (claimed.length > 0) {
    problems.push(
      `It claims ${quoted(claimed)}, which neither the ${thing} nor the author's notes show. Leave ${claimed.length === 1 ? 'it' : 'them'} out, and say only what the ${thing} demonstrates.`
    )
  }

  // A post, not the product's manual.
  if (!skipped.has('feature_sheet')) {
    const listLines = countListLines(draft.body)
    if (listLines > FEATURE_SHEET_LIMITS.listLines) {
      problems.push(
        `It is a list of ${listLines} points, one under another, which reads like a feature sheet. Tell it in short paragraphs, one per thing the ${thing} changes for the reader, or keep at most ${FEATURE_SHEET_LIMITS.listLines} lines, each an outcome in a sentence.`
      )
    }
    const lists = findLongLists(prose)
    if (lists.length > 0) {
      const [first] = lists
      problems.push(
        `"${first!.text}" names ${first!.items} things in one sentence, as a manual would. Say what they do for the reader together, with one or two examples they will recognise in the ${thing}; leave the rest to the ${thing}.`
      )
    }
    const announced = notAuthors(findFeatureSheetPhrases(prose))
    if (announced.length > 0) {
      problems.push(
        `${quoted(announced)} announces a feature list. Lead into what the ${thing} shows through what it changes for the reader.`
      )
    }
  }

  if (!skipped.has('repeated_message')) {
    // The closing question may come back to the point; the body says it once.
    const restated = findRestatedSentences(
      [draft.hook, draft.body].map(part => part.trim()).filter(Boolean).join('\n\n'),
      {
        ignore: [
          ctx.account.name,
          ctx.account.company ?? '',
          ...nameWordsOf(analysis.message.subject),
          ...ctx.offerings.map(o => o.name)
        ]
      }
    )
    if (restated.length > 0) {
      const [pair] = restated
      problems.push(
        `"${pair!.again}" says again what "${pair!.first}" already said. Say the main message once, and give every paragraph something new.`
      )
    }
  }

  if (!skipped.has('retold_sequence')) {
    const limits = DEFAULT_REPETITION_LIMITS
    if (countSequenceOpenings(draft.body) > limits.sequenceOpenings) {
      problems.push(
        `It walks through the ${thing} step by step ("First…", "Then…", "Next…"). The ${thing} already shows the steps: say what they add up to for the reader, and point to the one or two moments worth watching for.`
      )
    }
    const retold = findRetoldCaptions(prose, analysis.visibleText)
    if (retold.length > limits.retoldCaptions) {
      problems.push(
        `It repeats ${retold.length} of the ${thing}'s captions word for word (${quoted(retold.slice(0, 3))}). Say what they add up to, in your own words.`
      )
    }
    const noteWords = notes.trim().split(/\s+/).filter(Boolean).length
    if (noteWords >= NOTES_SCRIPT_WORDS) {
      const copied = longestSharedRun(prose, [notes])
      if (copied.length >= NOTES_COPIED_WORDS) {
        problems.push(
          `"${copied.text}" is the notes read out word for word. Use the notes as facts, in your own words.`
        )
      }
    }
  }

  if (!skipped.has('repeated_wording')) {
    const repeated = findRepeatedWording(prose, {
      ignore: [
        ctx.account.name,
        ctx.account.company ?? '',
        ...nameWordsOf(analysis.message.subject),
        ...ctx.offerings.map(o => o.name)
      ]
    })
    const parts = [
      ...repeated.words
        .slice(0, 3)
        .map(w => `"${w.word}" ${w.count} times`),
      ...repeated.phrases.slice(0, 2).map(p => `"${p}" more than once`),
      ...repeated.openings
        .slice(0, 2)
        .map(o => `several sentences opening with "${o}"`)
    ]
    if (parts.length > 0) {
      problems.push(
        `It repeats itself: ${parts.join('; ')}. Vary the wording, or cut the repeats.`
      )
    }
  }

  // A demo's sample store, test order or sample offer is not the reader's
  // business: nor is its "15% off", said as if the product gave it.
  const lowerNotes = notes.toLowerCase()
  const sampleData = analysis.message.scaffolding
    .map(s => s.trim())
    .filter(s => s.length >= 2 && !lowerNotes.includes(s.toLowerCase()))
  const proseFigures = new Set(figuresIn(prose))
  const scaffolding = [
    ...sampleData.filter(s => s.length >= 3 && wholeTermPattern(s).test(prose)),
    ...sampleData
      .flatMap(figuresIn)
      .filter(f => proseFigures.has(f) && !lowerNotes.includes(f))
  ].filter((s, i, all) => all.indexOf(s) === i)
  if (scaffolding.length > 0) {
    problems.push(
      `It names the demo's sample data (${quoted(scaffolding.slice(0, 3))}). Readers care about their own business, not the demo's: leave it out.`
    )
  }

  if (draft.formatId === 'linkedin.post' && !draft.cta.includes('?')) {
    problems.push(
      'It does not end on a question. Close, in cta, with one question the reader can answer from their own work, following from the post.'
    )
  }

  // Tags the author writes into their own sentences are their style.
  const inText = hashtagsInText(prose).filter(
    tag => !wholeTermPattern(tag).test(authorText)
  )
  if (inText.length > 0) {
    problems.push(
      `${quoted(inText.slice(0, 4))} ${inText.length === 1 ? 'is' : 'are'} written into the text. Hashtags go only in the hashtags field, one per item, and the post adds them on a line of their own at the end: say it in words in the sentence.`
    )
  }

  const generic = draft.hashtags.filter(tag =>
    GENERIC_HASHTAGS.has(tag.toLowerCase())
  )
  if (!casual && generic.length > 0) {
    problems.push(
      `${quoted(generic.map(t => `#${t}`))} ${generic.length === 1 ? 'is' : 'are'} too general to reach anyone. Use hashtags for the post's subject, industry or readers.`
    )
  }

  if (isShort && !draft.title.trim()) {
    problems.push(
      'The video has no title. Give it one: what the viewer gets, in the words they would search.'
    )
  }
  if (isShort && !captionOf(draft)) {
    problems.push('There is no description to post with the video.')
  }
  return problems
}
