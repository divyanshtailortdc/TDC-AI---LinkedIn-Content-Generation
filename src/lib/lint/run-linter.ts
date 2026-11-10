import { getPlatform } from '@/lib/platforms'
import {
  extractNumbers,
  mentionsFigure
} from '~/lib/ai/skills/ideation/guard'
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

export interface LintFinding {
  rule: string
  severity: 'error' | 'warning' | 'info'
  message: string
  passed: boolean
}

export interface LintOptions {
  hook: string
  body: string
  cta?: string | null
  firstComment?: string | null
  hashtags?: string[] | null
  linkPlacement?: 'first_comment' | 'body' | null
  bannedWords?: string[] | null
  bannedTopics?: string[] | null
  /** The post's platform, named in messages; the default platform when absent. */
  platformName?: string
  maxChars?: number
  /** Where the feed folds the post; null when the platform has no fold. */
  hookMaxChars?: number | null
  /** How the platform counts length; `String.length` (LinkedIn's count) when absent. */
  countChars?: ((text: string) => number) | null
  /**
   * The texts `maxChars` applies to, one per post: the post with its hashtags,
   * or each post of a thread. Absent: hook, body and call to action together,
   * as LinkedIn counts them.
   */
  limitTexts?: string[] | null
  /** How many posts a thread must have; absent for a single post. */
  partRange?: { min: number; max: number } | null
  /**
   * How hard engagement bait counts: an error (rewritten before review) by
   * default; a warning for a creator, whose "tag a friend" is normal.
   */
  engagementBaitSeverity?: 'error' | 'warning' | null
  /** What `limitTexts` are called in messages: "Post" unless a video's "Caption". */
  limitLabel?: string | null
  /** A video: its spoken length, caption and (YouTube) title. */
  video?: {
    seconds: number
    targetSeconds: number
    maxSeconds: number
    caption: string
    /** Null or absent: the platform takes no title. */
    title?: string | null
    titleMax?: number
  } | null
  /**
   * What a link in the post does on this platform and where it belongs
   * instead. Absent: LinkedIn's rule, where a body link costs reach unless
   * the goal puts links in the body.
   */
  linkRule?: {
    inBody: 'ok' | 'reach_penalty' | 'not_clickable'
    /** "the first comment", "a reply", "the bio". */
    fallbackLabel: string
  } | null
  /** From the voice's hashtag policy; null or absent skips the check. */
  hashtagRange?: { min: number; max: number } | null
  emojiLevel?: 'none' | 'bullets_only' | 'liberal' | null
  ctaRequired?: boolean
  citationsCount?: number
  minCitations?: number
  /**
   * Text every figure in the post must come from: its evidence and the
   * author's own details. Absent skips the check.
   */
  figureSources?: string | null
  /**
   * The wording of the evidence the post draws on (claims and quotes). A run
   * of its words in the post, outside quotation marks, was lifted. Absent
   * skips the check.
   */
  evidenceTexts?: string[] | null
  /** Closing asks of the account's recent posts; a near repeat is flagged. */
  recentCtas?: string[] | null
  /** Thresholds, skipped checks and the author's own posts; see writing-rules. */
  writing?: WritingSettings | null
}

/**
 * Buzzwords that read as filler regardless of account. Account-specific banned
 * words arrive through `bannedWords` and are checked alongside these.
 */
export const DEFAULT_BANNED_WORDS = [
  'delve',
  'leverage',
  'unlock',
  'game-changer',
  "in today's fast-paced world",
  "i'm thrilled to announce",
  'supercharge',
  'revolutionize',
  'tapestry',
  'demystify',
  'synergy'
]

const KNOWN_ACRONYMS = new Set([
  'CEO', 'CTO', 'COO', 'CFO', 'SAAS', 'API', 'LLM', 'AI', 'ROI', 'ARR', 'MRR',
  'B2B', 'B2C', 'CRM', 'ERP', 'SDK', 'SQL', 'HTTP', 'PR', 'KPI', 'RAG', 'ETL',
  'UX', 'UI', 'QA', 'ML', 'GPU', 'CPU', 'SEO'
])

export const EMOJI_REGEX = /\p{Extended_Pictographic}/gu

/** A closing line that would fit any post, so it asks the reader nothing. */
const GENERIC_CTA =
  /^(?:so,?\s+)?(?:thoughts|agree|what do you think|what are your thoughts|let me know (?:your thoughts|what you think|in the comments)|drop (?:a comment|your thoughts)(?: below)?|comment below)\s*[?.!]*$/i

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const WORD_CHAR = /[\p{L}\p{N}_]/u

/**
 * Matches `term` as a whole word, case-insensitively. `\b` cannot do this for
 * terms such as "—" or "🚀": it only exists next to word characters, so those
 * would never match. The boundary is added on a side only when the term's edge
 * character is a word character; a term like "—" matches wherever it appears.
 */
export function wholeTermPattern(term: string): RegExp {
  const chars = Array.from(term)
  const before = WORD_CHAR.test(chars[0]!) ? '(?<![\\p{L}\\p{N}_])' : ''
  const after = WORD_CHAR.test(chars[chars.length - 1]!) ? '(?![\\p{L}\\p{N}_])' : ''
  return new RegExp(`${before}${escapeRegex(term)}${after}`, 'iu')
}

export function runLinter(opts: LintOptions): LintFinding[] {
  const findings: LintFinding[] = []
  const platform = getPlatform()
  const platformName = opts.platformName ?? platform.name
  const maxChars = opts.maxChars ?? platform.limits.maxChars
  // Null: the platform has no fold, so there is no fold check.
  const hookMaxChars =
    opts.hookMaxChars === null ? null : (opts.hookMaxChars ?? platform.limits.hookMaxChars)
  const count = opts.countChars ?? ((text: string) => text.length)
  const hook = (opts.hook || '').trim()
  const fullText = `${opts.hook}\n\n${opts.body}${opts.cta ? `\n\n${opts.cta}` : ''}`.trim()
  const hookLength = count(hook)
  // "Close to the limit" is the last 200 characters of a long post, the last
  // tenth of a short one.
  const nearLimit = maxChars - Math.min(200, Math.round(maxChars * 0.1))

  // 1. Total length: of the post, or of each post in a thread.
  const limited = opts.limitTexts?.length ? opts.limitTexts : [fullText]
  const what = opts.limitLabel || 'Post'
  if (limited.length === 1 && !opts.partRange) {
    const charCount = count(limited[0]!)
    if (charCount > maxChars) {
      findings.push({
        rule: 'char_limit',
        severity: 'error',
        message: `${what} is ${charCount} characters, over the ${maxChars} character limit. Trim ${charCount - maxChars}.`,
        passed: false
      })
    } else if (charCount > nearLimit) {
      findings.push({
        rule: 'char_limit',
        severity: 'warning',
        message: `${what} is ${charCount} characters, close to the ${maxChars} limit.`,
        passed: true
      })
    } else {
      findings.push({
        rule: 'char_limit',
        severity: 'info',
        message: `Character count: ${charCount} / ${maxChars}`,
        passed: true
      })
    }
  } else {
    const counts = limited.map(count)
    const over = counts
      .map((n, i) => ({ n, post: i + 1 }))
      .filter(({ n }) => n > maxChars)
    findings.push(
      over.length > 0
        ? {
            rule: 'char_limit',
            severity: 'error',
            message: over
              .map(({ n, post }) => `Post ${post} of the thread is ${n} characters, over the ${maxChars} limit. Trim ${n - maxChars}.`)
              .join(' '),
            passed: false
          }
        : {
            rule: 'char_limit',
            severity: 'info',
            message: `Every post in the thread fits the ${maxChars} character limit (longest ${Math.max(0, ...counts)}).`,
            passed: true
          }
    )
    if (opts.partRange) {
      const { min, max } = opts.partRange
      findings.push(
        limited.length < min || limited.length > max
          ? {
              rule: 'thread_length',
              severity: 'warning',
              message: `The thread has ${limited.length} post${limited.length === 1 ? '' : 's'}; aim for ${min} to ${max}.`,
              passed: false
            }
          : {
              rule: 'thread_length',
              severity: 'info',
              message: `The thread has ${limited.length} posts.`,
              passed: true
            }
      )
    }
  }

  // 1b. A video: how long it takes to say, its caption and its title.
  if (opts.video) {
    const v = opts.video
    findings.push(
      v.seconds > v.maxSeconds
        ? {
            rule: 'script_length',
            severity: 'error',
            message: `The script takes about ${v.seconds} seconds to say, over the ${v.maxSeconds} second limit. Cut about ${v.seconds - v.maxSeconds} seconds.`,
            passed: false
          }
        : v.seconds > Math.round(v.targetSeconds * 1.5)
          ? {
              rule: 'script_length',
              severity: 'warning',
              message: `The script takes about ${v.seconds} seconds to say; aim for about ${v.targetSeconds}.`,
              passed: false
            }
          : {
              rule: 'script_length',
              severity: 'info',
              message: `The script takes about ${v.seconds} seconds to say.`,
              passed: true
            }
    )
    if (!v.caption.trim()) {
      findings.push({
        rule: 'caption_missing',
        severity: 'warning',
        message: 'There is no caption to post with the video.',
        passed: false
      })
    }
    if (v.title != null) {
      const titleMax = v.titleMax ?? 100
      if (!v.title.trim()) {
        findings.push({
          rule: 'video_title',
          severity: 'warning',
          message: 'The video has no title.',
          passed: false
        })
      } else if (v.title.length > titleMax) {
        findings.push({
          rule: 'video_title',
          severity: 'error',
          message: `The title is ${v.title.length} characters, over the ${titleMax} limit.`,
          passed: false
        })
      }
    }
  }

  // 2. The fold, on platforms that have one.
  if (hookMaxChars !== null) {
    if (hookLength > hookMaxChars) {
      findings.push({
        rule: 'hook_fold',
        severity: 'warning',
        message: `Hook is ${hookLength} characters, past the ${hookMaxChars} character fold. The tail will sit behind "…see more".`,
        passed: false
      })
    } else {
      findings.push({
        rule: 'hook_fold',
        severity: 'info',
        message: `Hook fits the ${hookMaxChars} character fold (${hookLength}).`,
        passed: true
      })
    }
  }

  // 2b. A hook cut mid-word reads as a mistake in the feed.
  if (
    hookMaxChars !== null &&
    hookLength > 0 &&
    hookLength <= hookMaxChars &&
    /[A-Za-z0-9,]$/.test(hook)
  ) {
    findings.push({
      rule: 'hook_completeness',
      severity: 'info',
      message: 'Hook does not end on sentence punctuation; check it reads as a complete thought at the fold.',
      passed: true
    })
  }

  // 3. Markdown — plain-text platforms render none of it
  const markdownPatterns = [
    { pattern: /\*\*[^*]+\*\*/, name: 'bold (**text**)' },
    { pattern: /__[^_]+__/, name: 'underline (__text__)' },
    { pattern: /^#{1,6}\s/m, name: 'heading (# Heading)' },
    { pattern: /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/, name: 'link ([text](url))' },
    { pattern: /^\s*[-*]\s+/m, name: 'bullet (- item)' },
    { pattern: /```/, name: 'code fence (```)' }
  ]
  const detectedMarkdown = markdownPatterns
    .filter(({ pattern }) => pattern.test(fullText))
    .map(({ name }) => name)

  findings.push(
    detectedMarkdown.length > 0
      ? {
          rule: 'no_markdown_leakage',
          severity: 'error',
          message: `${platformName} shows markdown as literal characters. Found: ${detectedMarkdown.join(', ')}.`,
          passed: false
        }
      : {
          rule: 'no_markdown_leakage',
          severity: 'info',
          message: 'No markdown syntax detected.',
          passed: true
        }
  )

  // 4. Link placement
  const urlPattern = /https?:\/\/[^\s]+/gi
  // Other formats also check the text their limit covers (a video's caption).
  const urlsInBody = opts.limitTexts?.length
    ? Array.from(
        new Set([
          ...(fullText.match(urlPattern) || []),
          ...(opts.limitTexts.join('\n').match(urlPattern) || [])
        ])
      )
    : fullText.match(urlPattern) || []
  const strategy = opts.linkPlacement || 'first_comment'
  const linkRule = opts.linkRule
  const shownUrls = urlsInBody.slice(0, 3).join(', ')
  findings.push(
    linkRule?.inBody === 'not_clickable' && urlsInBody.length > 0
      ? {
          rule: 'link_placement',
          severity: 'warning',
          message: `Links are not clickable in a ${platformName} post: ${shownUrls}. Point readers to ${linkRule.fallbackLabel} instead.`,
          passed: false
        }
      : linkRule?.inBody !== 'ok' &&
          linkRule?.inBody !== 'not_clickable' &&
          strategy === 'first_comment' &&
          urlsInBody.length > 0
        ? {
            rule: 'link_placement',
            severity: 'warning',
            message: `External links in the body reduce reach: ${shownUrls}. Move them to ${linkRule?.fallbackLabel ?? 'the first comment'}.`,
            passed: false
          }
        : {
            rule: 'link_placement',
            severity: 'info',
            message: 'Link placement matches the configured strategy.',
            passed: true
          }
  )

  // 5. Banned words
  const allBanned = Array.from(
    new Set([
      ...DEFAULT_BANNED_WORDS,
      ...(opts.bannedWords || []).map(w => w.toLowerCase().trim())
    ])
  ).filter(Boolean)

  const detectedBanned = allBanned.filter(word =>
    wholeTermPattern(word).test(fullText)
  )

  findings.push(
    detectedBanned.length > 0
      ? {
          rule: 'banned_words',
          severity: 'warning',
          message: `Contains banned or cliché wording: ${detectedBanned.map(w => `"${w}"`).join(', ')}.`,
          passed: false
        }
      : {
          rule: 'banned_words',
          severity: 'info',
          message: 'No banned wording detected.',
          passed: true
        }
  )

  // 6. Banned topics from the account guardrails
  const bannedTopics = (opts.bannedTopics || []).map(t => t.toLowerCase().trim()).filter(Boolean)
  if (bannedTopics.length > 0) {
    const hits = bannedTopics.filter(topic =>
      wholeTermPattern(topic).test(fullText)
    )
    findings.push(
      hits.length > 0
        ? {
            rule: 'banned_topics',
            severity: 'error',
            message: `Touches a topic this account has ruled out: ${hits.join(', ')}.`,
            passed: false
          }
        : {
            rule: 'banned_topics',
            severity: 'info',
            message: 'Stays clear of banned topics.',
            passed: true
          }
    )
  }

  // 7. Hashtag count
  if (opts.hashtagRange) {
    const { min, max } = opts.hashtagRange
    const actual = (opts.hashtags || []).filter(Boolean).length
    const wanted = min === max ? `${min}` : `${min}–${max}`
    findings.push(
      actual < min || actual > max
        ? {
            rule: 'hashtag_count',
            severity: 'warning',
            message: `${actual} hashtag${actual === 1 ? '' : 's'} present, but the voice asks for ${wanted}.`,
            passed: false
          }
        : {
            rule: 'hashtag_count',
            severity: 'info',
            message: `Hashtag count matches the voice (${actual}).`,
            passed: true
          }
    )
  }

  // 8. Emoji policy
  if (opts.emojiLevel) {
    const emojiCount = (fullText.match(EMOJI_REGEX) || []).length
    if (opts.emojiLevel === 'none' && emojiCount > 0) {
      findings.push({
        rule: 'emoji_policy',
        severity: 'warning',
        message: `${emojiCount} emoji found, but this account's policy is none.`,
        passed: false
      })
    } else if (opts.emojiLevel === 'bullets_only' && emojiCount > 6) {
      findings.push({
        rule: 'emoji_policy',
        severity: 'warning',
        message: `${emojiCount} emoji found. Policy allows them as list markers only.`,
        passed: false
      })
    } else {
      findings.push({
        rule: 'emoji_policy',
        severity: 'info',
        message: 'Emoji use matches the configured policy.',
        passed: true
      })
    }
  }

  // 9. Required CTA
  if (opts.ctaRequired) {
    const hasCta = Boolean(opts.cta && opts.cta.trim().length > 0)
    findings.push(
      hasCta
        ? { rule: 'cta_required', severity: 'info', message: 'Call to action present.', passed: true }
        : {
            rule: 'cta_required',
            severity: 'warning',
            message: 'Preferences require a call to action, but none was written.',
            passed: false
          }
    )
  }

  // 9b. A CTA that would fit any post
  if (opts.cta && GENERIC_CTA.test(opts.cta.trim())) {
    findings.push({
      rule: 'generic_cta',
      severity: 'warning',
      message: `"${opts.cta.trim()}" would close any post. Ask for something that follows from this one.`,
      passed: false
    })
  }

  // 10. Engagement bait
  const engagementBait =
    /\b(comment\s+["']?yes["']?|type\s+["']?yes["']?|tag\s+a\s+friend|tag\s+someone\s+who|share\s+if\s+you\s+agree|smash\s+that\s+like)\b/i
  if (engagementBait.test(fullText)) {
    findings.push({
      rule: 'engagement_bait',
      severity: opts.engagementBaitSeverity ?? 'error',
      message: `Engagement bait detected. ${platformName} penalises posts that ask for interactions this way.`,
      passed: false
    })
  }

  // 11. Numeric claims need citations
  const numericPattern =
    /\b\d+(\.\d+)?\s*%|[$£€]\s?\d+(\.\d+)?[kKmMbB]?|\b\d+(\.\d+)?x\b|\b\d[\d,]*\s*(million|billion|thousand)\b/gi
  const numericMatches = fullText.match(numericPattern) || []
  const citations = opts.citationsCount ?? 0
  const minCitations = opts.minCitations ?? 1

  if (numericMatches.length > 0) {
    findings.push(
      citations < minCitations
        ? {
            rule: 'grounded_citations',
            severity: 'warning',
            message: `Numeric claims present (${numericMatches.slice(0, 3).join(', ')}) with ${citations} citation${citations === 1 ? '' : 's'}; preferences ask for at least ${minCitations}.`,
            passed: false
          }
        : {
            rule: 'grounded_citations',
            severity: 'info',
            message: `${numericMatches.length} numeric claim${numericMatches.length === 1 ? '' : 's'} backed by ${citations} citation${citations === 1 ? '' : 's'}.`,
            passed: true
          }
    )
  }

  // 11b. Every figure must come from the evidence or the author's own details.
  // The citation count above only shows that some evidence exists.
  if (opts.figureSources != null) {
    const sources = opts.figureSources.toLowerCase()
    const known = new Set(extractNumbers(sources))
    // Whole figures only: a substring test let "5%" pass on "25%".
    const invented = extractNumbers(
      `${fullText}\n${opts.firstComment || ''}`
    ).filter(n => !known.has(n) && !mentionsFigure(sources, n))
    findings.push(
      invented.length > 0
        ? {
            rule: 'unsupported_figures',
            severity: 'error',
            message: `${invented.map(n => `"${n}"`).join(', ')} ${invented.length === 1 ? 'does' : 'do'} not appear in this post's evidence or the author's details. Remove ${invented.length === 1 ? 'it' : 'them'} or use a figure from the evidence.`,
            passed: false
          }
        : {
            rule: 'unsupported_figures',
            severity: 'info',
            message: 'Every figure appears in the evidence or the author\'s details.',
            passed: true
          }
    )
  }

  // 12. Shouting
  const capsWords = fullText
    .split(/\s+/)
    .filter(w => /^[A-Z]{3,}$/.test(w) && !KNOWN_ACRONYMS.has(w))
  if (capsWords.length > 3) {
    findings.push({
      rule: 'excessive_caps',
      severity: 'warning',
      message: `All-caps words detected (${capsWords.slice(0, 4).join(', ')}). Reads as shouting.`,
      passed: false
    })
  }

  // 13. Writing habits that read as machine-written. Each only reports when
  // it finds something, like the shouting check above. The phrase lists and
  // thresholds are in writing-rules; `opts.writing` adjusts them per account.
  const prose = `${opts.hook}\n\n${opts.body}${opts.cta ? `\n\n${opts.cta}` : ''}`
  const limits = { ...DEFAULT_WRITING_THRESHOLDS, ...opts.writing?.thresholds }
  const skipped = new Set<WritingCheck>(opts.writing?.skip)
  const authorText = opts.writing?.authorText?.toLowerCase() || ''
  // A phrase the author already writes in their own posts is theirs.
  const notAuthors = (found: string[]) =>
    authorText ? found.filter(f => !authorText.includes(f.toLowerCase())) : found
  const quoted = (found: string[]) => found.map(v => `"${v}"`).join(', ')
  const warn = (rule: WritingCheck, message: string) => {
    if (skipped.has(rule)) return
    findings.push({ rule, severity: 'warning', message, passed: false })
  }

  const frames = countContrastFrames(prose)
  if (frames > limits.contrastFrames) {
    warn(
      'contrast_overuse',
      `${frames} "it's not X, it's Y" turns in one post reads as a template. Keep at most ${limits.contrastFrames} and state the rest directly.`
    )
  }

  if (countEmDashes(prose) > limits.emDashes && !authorText.includes('—')) {
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

  // What the post may say: its evidence and the author's own details.
  const sweeping = notAuthors(findSweepingClaims(prose, opts.figureSources))
  if (sweeping.length > 0) {
    warn(
      'sweeping_claim',
      `${quoted(sweeping)} is not backed by this post's evidence. Hedge it ("many", "often") or cut it.`
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
      `${quoted(meta)} announces what the post is. Show it instead.`
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
        `"${copied.text}" is word for word from a source. Paraphrase it, or put it in quotation marks and name the source.`
      )
    }
  }

  const cta = opts.cta?.trim()
  if (
    cta &&
    opts.recentCtas?.some(r => ctaSimilarity(cta, r) >= limits.sameCtaSimilarity)
  ) {
    warn(
      'repeated_cta',
      "This closing ask is nearly the same as one on a recent post. Ask something different, or end on a question about the reader's own work."
    )
  }

  return findings
}
