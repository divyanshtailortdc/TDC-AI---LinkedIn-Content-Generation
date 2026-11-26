import {
  blogWordCount,
  docOutline,
  docParagraphs,
  type BlogDoc
} from '@/lib/blogs/doc'
import {
  checkCitations,
  docSentences,
  proseParagraphs,
  figureText as figureTextOf,
  statesFigure
} from '@/lib/blogs/citations'
import type { BlogSource, FaqItem, SearchIntent } from '@/lib/blogs/types'
import { extractNumbers, mentionsFigure } from '~/lib/ai/skills/ideation/guard'
import {
  DEFAULT_BANNED_WORDS,
  EMOJI_REGEX,
  wholeTermPattern,
  type LintFinding
} from './run-linter'
import {
  countContrastFrames,
  countEmDashes,
  ctaSimilarity,
  findExperienceClaims,
  findFillerPhrases,
  findMetaStatements,
  findSweepingClaims,
  findVagueAttributions,
  longestSharedRun
} from './writing-checks'
import {
  DEFAULT_WRITING_THRESHOLDS,
  type WritingCheck,
  type WritingSettings
} from './writing-rules'

/**
 * The truth and writing checks for a blog or article: the detectors posts use
 * (./run-linter, ./writing-checks), composed for long text, with writing-habit
 * allowances that grow with length. Length, structure and keywords are the SEO
 * checks' (src/lib/blogs/seo.ts). The FAQ is checked with the body.
 *
 * Same finding shape as posts: a blocking finding is an `error` not `passed`.
 */

export interface BlogLintOptions {
  title: string
  content: BlogDoc
  faq: FaqItem[]
  bannedWords?: string[] | null
  bannedTopics?: string[] | null
  emojiLevel?: 'none' | 'bullets_only' | 'liberal' | null
  /** Text every figure must come from; absent skips the check. */
  figureSources?: string | null
  /** Third-party wording the blog must not lift; absent skips the check. */
  evidenceTexts?: string[] | null
  writing?: WritingSettings | null
  /** The company's and its products' names, for the sales-pitch check. */
  brandNames?: string[] | null
  /** Informational pieces may say less about the products than commercial ones. */
  searchIntent?: SearchIntent | '' | null
  /**
   * The sources and the author's own details, for checking each figure
   * against the source its sentence links; absent skips the check.
   */
  citations?: { sources: BlogSource[]; authorText: string } | null
}

/** Past this share of paragraphs about the company, a piece reads as a pitch. */
const PITCH_SHARE = { informational: 0.25, other: 0.45 }
/** Fewer paragraphs than this are too few to judge. */
const PITCH_MIN_PARAGRAPHS = 6
/** Citation findings shown per check, at most. */
const MAX_CITATION_FINDINGS = 8

/** Paragraphs at least this long are compared for repeats. */
const REPEAT_MIN_WORDS = 20
const REPEAT_SIMILARITY = 0.75
/** Writing-habit allowances are per this many words. */
const WORDS_PER_ALLOWANCE = 500

const MARKDOWN_LEAKS = [
  { pattern: /\*\*[^*]+\*\*/, name: 'bold (**text**)' },
  { pattern: /(^|\n)\s*#{1,6}\s/, name: 'heading (# Heading)' },
  { pattern: /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/, name: 'link ([text](url))' },
  { pattern: /```/, name: 'code fence (```)' }
]

export function runBlogLinter(opts: BlogLintOptions): LintFinding[] {
  const findings: LintFinding[] = []
  const pass = (rule: string, message: string) =>
    findings.push({ rule, severity: 'info', message, passed: true })
  const fail = (rule: string, severity: 'error' | 'warning', message: string) =>
    findings.push({ rule, severity, message, passed: false })

  const paragraphs = [
    ...docParagraphs(opts.content),
    ...opts.faq.map(item => item.answer.trim()).filter(Boolean)
  ]
  const prose = [
    opts.title.trim(),
    ...docOutline(opts.content).map(h => h.text),
    ...opts.faq.map(item => item.question.trim()),
    ...paragraphs
  ]
    .filter(Boolean)
    .join('\n\n')
  const words = blogWordCount(opts.content, opts.faq)

  // 1. Markdown that survived as literal characters
  const leaked = MARKDOWN_LEAKS.filter(({ pattern }) =>
    pattern.test(prose)
  ).map(({ name }) => name)
  if (leaked.length > 0) {
    fail(
      'no_markdown_leakage',
      'warning',
      `Markdown shows as literal characters: ${leaked.join(', ')}. Use the editor's formatting instead.`
    )
  }

  // 2. Banned words and topics
  const banned = Array.from(
    new Set([
      ...DEFAULT_BANNED_WORDS,
      ...(opts.bannedWords || []).map(w => w.toLowerCase().trim())
    ])
  ).filter(Boolean)
  const bannedHits = banned.filter(w => wholeTermPattern(w).test(prose))
  if (bannedHits.length > 0) {
    fail(
      'banned_words',
      'warning',
      `Contains banned or cliché wording: ${bannedHits.map(w => `"${w}"`).join(', ')}.`
    )
  } else pass('banned_words', 'No banned wording.')

  const topics = (opts.bannedTopics || [])
    .map(t => t.toLowerCase().trim())
    .filter(Boolean)
  if (topics.length > 0) {
    const hits = topics.filter(t => wholeTermPattern(t).test(prose))
    if (hits.length > 0) {
      fail(
        'banned_topics',
        'error',
        `Touches a topic this identity has ruled out: ${hits.join(', ')}.`
      )
    } else pass('banned_topics', 'Stays clear of banned topics.')
  }

  // 3. Emoji
  if (opts.emojiLevel && opts.emojiLevel !== 'liberal') {
    const emoji = (prose.match(EMOJI_REGEX) || []).length
    if (emoji > 0) {
      fail(
        'emoji_policy',
        'warning',
        `${emoji} emoji found; this identity writes without them.`
      )
    }
  }

  // 4. Every figure must come from the sources or the author's own details;
  // a hypothetical example's illustrative numbers are labelled as such.
  if (opts.figureSources != null) {
    const sources = opts.figureSources.toLowerCase()
    const known = new Set(extractNumbers(figureTextOf(sources)))
    const factual = [
      opts.title.trim(),
      ...docOutline(opts.content).map(h => h.text),
      ...docSentences(opts.content)
        .filter(sentence => !sentence.inExample)
        .map(sentence => sentence.text),
      ...opts.faq.flatMap(item => [item.question, item.answer])
    ].join('\n')
    const invented = Array.from(
      new Set(
        extractNumbers(factual).filter(
          n => !known.has(n) && !statesFigure(sources, n)
        )
      )
    )
    if (invented.length > 0) {
      fail(
        'unsupported_figures',
        'error',
        `${invented
          .slice(0, 6)
          .map(n => `"${n}"`)
          .join(
            ', '
          )} ${invented.length === 1 ? 'does' : 'do'} not appear in the sources or the author's details. Remove ${invented.length === 1 ? 'it' : 'them'} or use a figure from the sources.`
      )
    } else {
      pass(
        'unsupported_figures',
        "Every figure appears in the sources or the author's details."
      )
    }
  }

  // 5. The same point made twice
  const long = paragraphs.filter(p => p.split(/\s+/).length >= REPEAT_MIN_WORDS)
  let repeat: string | null = null
  outer: for (let i = 0; i < long.length; i++) {
    for (let j = i + 1; j < long.length; j++) {
      if (ctaSimilarity(long[i]!, long[j]!) >= REPEAT_SIMILARITY) {
        repeat = long[j]!
        break outer
      }
    }
  }
  if (repeat) {
    fail(
      'repeated_paragraphs',
      'warning',
      `Two paragraphs make nearly the same point ("${repeat.slice(0, 80)}…"). Cut one or make it add something new.`
    )
  }

  // 6. Habits that read as machine-written, allowed in proportion to length
  const scale = Math.max(1, Math.ceil(words / WORDS_PER_ALLOWANCE))
  const limits = { ...DEFAULT_WRITING_THRESHOLDS, ...opts.writing?.thresholds }
  const skipped = new Set<WritingCheck>(opts.writing?.skip)
  const authorText = opts.writing?.authorText?.toLowerCase() || ''
  const notAuthors = (found: string[]) =>
    authorText
      ? found.filter(f => !authorText.includes(f.toLowerCase()))
      : found
  const quoted = (found: string[]) => found.map(v => `"${v}"`).join(', ')
  const warn = (rule: WritingCheck, message: string) => {
    if (!skipped.has(rule)) fail(rule, 'warning', message)
  }

  const frames = countContrastFrames(prose)
  if (frames > limits.contrastFrames * scale) {
    warn(
      'contrast_overuse',
      `${frames} "it's not X, it's Y" turns reads as a template. State most of them directly.`
    )
  }
  if (
    countEmDashes(prose) > limits.emDashes * scale &&
    !authorText.includes('—')
  ) {
    warn(
      'dash_overuse',
      'Many em dashes. Use full stops or commas for most of them.'
    )
  }
  const vague = notAuthors(findVagueAttributions(prose))
  if (vague.length > 0) {
    warn(
      'vague_attribution',
      `${quoted(vague)} names no source. Name who said it, or leave the claim out.`
    )
  }
  const sweeping = notAuthors(findSweepingClaims(prose, opts.figureSources))
  if (sweeping.length > 0) {
    warn(
      'sweeping_claim',
      `${quoted(sweeping)} is not backed by the sources. Hedge it ("many", "often") or cut it.`
    )
  }
  const experience = notAuthors(findExperienceClaims(prose))
  if (experience.length > 0) {
    warn(
      'unverified_experience',
      `${quoted(experience)} states first-hand experience. Keep it only if it is true of the author.`
    )
  }
  const meta = notAuthors(findMetaStatements(prose))
  if (meta.length > 0) {
    warn(
      'meta_statement',
      `${quoted(meta)} announces what the piece is. Show it instead.`
    )
  }
  const filler = notAuthors(findFillerPhrases(prose))
  if (filler.length > 0) {
    warn(
      'filler_phrase',
      `${quoted(filler)} is throat-clearing. Say the point.`
    )
  }
  if (opts.evidenceTexts && opts.evidenceTexts.length > 0) {
    const copied = longestSharedRun(prose, opts.evidenceTexts)
    if (copied.length >= limits.copiedRunWords) {
      warn(
        'copied_source_text',
        `"${copied.text}" is word for word from a source. Paraphrase it, or quote it and name the source.`
      )
    }
  }

  // 7. How much of the piece is about the company's own products
  const brands = (opts.brandNames ?? []).map(name => name.trim()).filter(Boolean)
  const paragraphsForPitch = proseParagraphs(opts.content)
  if (brands.length > 0 && paragraphsForPitch.length >= PITCH_MIN_PARAGRAPHS) {
    const patterns = brands.map(name => wholeTermPattern(name.toLowerCase()))
    const about = paragraphsForPitch.filter(paragraph =>
      patterns.some(pattern => pattern.test(paragraph.toLowerCase()))
    ).length
    const informational = !opts.searchIntent || opts.searchIntent === 'informational'
    const limit = informational ? PITCH_SHARE.informational : PITCH_SHARE.other
    if (about / paragraphsForPitch.length > limit) {
      fail(
        'product_share',
        'warning',
        `${about} of ${paragraphsForPitch.length} paragraphs are about ${brands[0]}: it reads like a sales pitch. Keep the product to one passage and the call to action.`
      )
    } else pass('product_share', 'The products take their fair share of the piece.')
  }

  // 8. Each figure against the source its sentence links
  if (opts.citations) {
    const problems = checkCitations({
      doc: opts.content,
      sources: opts.citations.sources,
      authorText: opts.citations.authorText
    })
    const excerpt = (sentence: string) =>
      sentence.length > 90 ? `${sentence.slice(0, 87)}…` : sentence
    const report = (
      rule: string,
      severity: 'error' | 'warning',
      kinds: string[],
      message: (p: (typeof problems)[number]) => string
    ) => {
      const found = problems.filter(p => kinds.includes(p.rule))
      for (const problem of found.slice(0, MAX_CITATION_FINDINGS)) {
        fail(rule, severity, message(problem))
      }
      return found.length
    }
    const wrong = report(
      'citation_figure',
      'error',
      ['figure_not_in_source', 'chart_value_not_in_source'],
      p =>
        `${quoted(p.figures ?? [])} in "${excerpt(p.sentence)}" is not in the source it cites${p.sourceId ? ` (${p.sourceId})` : ''}. Cite the source that gives it, or change the figure.`
    )
    if (wrong === 0) {
      pass('citation_figure', 'Every figure is in the source it cites.')
    }
    report(
      'uncited_figure',
      'warning',
      ['uncited_figure'],
      p =>
        `${quoted(p.figures ?? [])} comes from a source, but "${excerpt(p.sentence)}" does not link it.`
    )
    report(
      'unlabelled_specific',
      'warning',
      ['unlabelled_specific'],
      p =>
        `"${excerpt(p.sentence)}" gives ${quoted(p.figures ?? [])} as if it happened. Put an illustrative scenario in a Hypothetical example box, or remove the detail.`
    )
  }

  return findings
}

/** The findings that should stop a generated blog going out as it is. */
export const blockingFindings = (findings: LintFinding[]) =>
  findings.filter(f => f.severity === 'error' && !f.passed)
