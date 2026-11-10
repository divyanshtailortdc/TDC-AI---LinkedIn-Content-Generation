import {
  articleOutline,
  countArticleWords,
  inlineToText,
  type ArticleBlock
} from '@/lib/articles/blocks'
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
 * The quality checks for a long-form article: the same truth and writing
 * checks a post gets (src/lib/lint/run-linter.ts, ./writing-checks), with the
 * format rules of an article instead of a feed post: length in words, a
 * structure of sections, no repeated paragraphs, and thresholds that scale
 * with length. A post's fold, hashtag and character limits do not apply.
 *
 * Same finding shape as posts, so a blocking finding is an `error` that is
 * not `passed`.
 */

export interface ArticleLintOptions {
  title: string
  subtitle?: string | null
  content: ArticleBlock[]
  callToAction?: string | null
  bannedWords?: string[] | null
  bannedTopics?: string[] | null
  emojiLevel?: 'none' | 'bullets_only' | 'liberal' | null
  /** Text every figure must come from; absent skips the check. */
  figureSources?: string | null
  /** Third-party wording the article must not lift; absent skips the check. */
  evidenceTexts?: string[] | null
  writing?: WritingSettings | null
  /** The length the article aims for, in words. */
  targetWords?: { min: number; max: number }
}

/** Below and above these the article is too thin or too long for the format. */
const HARD_WORDS = { min: 500, max: 4000 }
const TITLE_MAX = 100
const SUBTITLE_MAX = 300
/** Paragraphs at least this long are compared for repeats. */
const REPEAT_MIN_WORDS = 20
const REPEAT_SIMILARITY = 0.75
/** Writing-habit thresholds are per this many words. */
const WORDS_PER_ALLOWANCE = 500

function paragraphsOf(blocks: ArticleBlock[]): string[] {
  return blocks.flatMap(b =>
    b.type === 'list' ? b.items.map(inlineToText) : [inlineToText(b.text)]
  )
}

export function runArticleLinter(opts: ArticleLintOptions): LintFinding[] {
  const findings: LintFinding[] = []
  const pass = (rule: string, message: string) =>
    findings.push({ rule, severity: 'info', message, passed: true })
  const fail = (rule: string, severity: 'error' | 'warning', message: string) =>
    findings.push({ rule, severity, message, passed: false })

  const title = (opts.title || '').trim()
  const subtitle = (opts.subtitle || '').trim()
  const body = paragraphsOf(opts.content)
  const prose = [title, subtitle, ...body, opts.callToAction || '']
    .filter(Boolean)
    .join('\n\n')
  const words = countArticleWords(opts.content)
  const target = opts.targetWords ?? { min: 1100, max: 1800 }

  // 1. Length
  if (words < HARD_WORDS.min) {
    fail(
      'word_count',
      'warning',
      `The article is ${words} words: thin for a long-form article. Aim for about ${target.min}-${target.max}.`
    )
  } else if (words < target.min) {
    fail(
      'word_count',
      'warning',
      `The article is ${words} words, under the ${target.min}-${target.max} a long-form article aims for. Add an example or explanation where a section is thin, rather than repeating points.`
    )
  } else if (words > HARD_WORDS.max) {
    fail(
      'word_count',
      'warning',
      `The article is ${words} words. Few readers finish more than ${HARD_WORDS.max}; cut a section or split it into two articles.`
    )
  } else {
    pass('word_count', `${words} words (aim ${target.min}-${target.max}).`)
  }

  // 2. Title and subtitle
  if (!title) fail('title', 'error', 'The article has no title.')
  else if (title.length > TITLE_MAX) {
    fail(
      'title',
      'warning',
      `The title is ${title.length} characters; long titles are cut off in the feed. Keep it under ${TITLE_MAX}.`
    )
  } else pass('title', `Title is ${title.length} characters.`)
  if (subtitle.length > SUBTITLE_MAX) {
    fail(
      'subtitle',
      'warning',
      `The subtitle is ${subtitle.length} characters. Keep it to a sentence or two.`
    )
  }

  // 3. Structure: sections under headings
  const headings = articleOutline(opts.content).filter(h => h.level === 2)
  if (headings.length < 2) {
    fail(
      'structure',
      'warning',
      `Only ${headings.length} section heading${headings.length === 1 ? '' : 's'}. Readers scan long articles by their headings; break it into sections.`
    )
  } else {
    pass('structure', `${headings.length} sections.`)
  }
  const duplicateHeadings = headings
    .map(h => h.text.toLowerCase())
    .filter((h, i, all) => all.indexOf(h) !== i)
  if (duplicateHeadings.length > 0) {
    fail(
      'duplicate_headings',
      'warning',
      `Two sections share the heading "${duplicateHeadings[0]}".`
    )
  }

  // 4. Markdown that survived as literal characters
  const leaked = [
    { pattern: /\*\*[^*]+\*\*/, name: 'bold (**text**)' },
    { pattern: /^#{1,6}\s/m, name: 'heading (# Heading)' },
    {
      pattern: /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/,
      name: 'link ([text](url))'
    },
    { pattern: /```/, name: 'code fence (```)' }
  ]
    .filter(({ pattern }) => pattern.test(prose))
    .map(({ name }) => name)
  if (leaked.length > 0) {
    fail(
      'no_markdown_leakage',
      'warning',
      `Markdown shows as literal characters: ${leaked.join(', ')}. Use the editor's formatting instead.`
    )
  }

  // 5. Banned words and topics
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
  } else pass('banned_words', 'No banned wording detected.')

  const topics = (opts.bannedTopics || [])
    .map(t => t.toLowerCase().trim())
    .filter(Boolean)
  if (topics.length > 0) {
    const hits = topics.filter(t => wholeTermPattern(t).test(prose))
    if (hits.length > 0) {
      fail(
        'banned_topics',
        'error',
        `Touches a topic this account has ruled out: ${hits.join(', ')}.`
      )
    } else pass('banned_topics', 'Stays clear of banned topics.')
  }

  // 6. Emoji
  if (opts.emojiLevel && opts.emojiLevel !== 'liberal') {
    const emoji = (prose.match(EMOJI_REGEX) || []).length
    if (emoji > 0) {
      fail(
        'emoji_policy',
        'warning',
        `${emoji} emoji found; this account's articles use none.`
      )
    }
  }

  // 7. Every figure must come from the evidence, the knowledge used or the
  // author's own details.
  if (opts.figureSources != null) {
    const sources = opts.figureSources.toLowerCase()
    const known = new Set(extractNumbers(sources))
    const invented = Array.from(
      new Set(
        extractNumbers(prose).filter(
          n => !known.has(n) && !mentionsFigure(sources, n)
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
          )} ${invented.length === 1 ? 'does' : 'do'} not appear in the evidence, the knowledge used or the author's details. Remove ${invented.length === 1 ? 'it' : 'them'} or use a figure from the sources.`
      )
    } else {
      pass(
        'unsupported_figures',
        "Every figure appears in the sources or the author's details."
      )
    }
  }

  // 8. The same point made twice
  const long = body.filter(p => p.split(/\s+/).length >= REPEAT_MIN_WORDS)
  let repeat: [string, string] | null = null
  outer: for (let i = 0; i < long.length; i++) {
    for (let j = i + 1; j < long.length; j++) {
      if (ctaSimilarity(long[i]!, long[j]!) >= REPEAT_SIMILARITY) {
        repeat = [long[i]!, long[j]!]
        break outer
      }
    }
  }
  if (repeat) {
    fail(
      'repeated_paragraphs',
      'warning',
      `Two paragraphs make nearly the same point ("${repeat[1].slice(0, 80)}…"). Cut one or make it add something new.`
    )
  }

  // 9. Writing habits that read as machine-written, allowed in proportion
  // to length (a 1,500-word article gets three times a post's allowance).
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
      `${quoted(meta)} announces what the article is. Show it instead.`
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

  return findings
}

/** The findings that should stop the article going out as it is. */
export const blockingFindings = (findings: LintFinding[]) =>
  findings.filter(f => f.severity === 'error' && !f.passed)
