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
  maxChars?: number
  hookMaxChars?: number
  /** From the voice's hashtag policy; null or absent skips the check. */
  hashtagRange?: { min: number; max: number } | null
  emojiLevel?: 'none' | 'bullets_only' | 'liberal' | null
  ctaRequired?: boolean
  citationsCount?: number
  minCitations?: number
}

/**
 * Buzzwords that read as filler regardless of account. Account-specific banned
 * words arrive through `bannedWords` and are checked alongside these.
 */
const DEFAULT_BANNED_WORDS = [
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

const EMOJI_REGEX = /\p{Extended_Pictographic}/gu

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function runLinter(opts: LintOptions): LintFinding[] {
  const findings: LintFinding[] = []
  const maxChars = opts.maxChars ?? 3000
  const hookMaxChars = opts.hookMaxChars ?? 200
  const hook = (opts.hook || '').trim()
  const fullText = `${opts.hook}\n\n${opts.body}${opts.cta ? `\n\n${opts.cta}` : ''}`.trim()
  const charCount = fullText.length
  const hookLength = hook.length

  // 1. Total length
  if (charCount > maxChars) {
    findings.push({
      rule: 'char_limit',
      severity: 'error',
      message: `Post is ${charCount} characters, over the ${maxChars} character limit. Trim ${charCount - maxChars}.`,
      passed: false
    })
  } else if (charCount > maxChars - 200) {
    findings.push({
      rule: 'char_limit',
      severity: 'warning',
      message: `Post is ${charCount} characters, close to the ${maxChars} limit.`,
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

  // 2. The fold
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

  // 2b. A hook cut mid-word reads as a mistake in the feed.
  if (hookLength > 0 && hookLength <= hookMaxChars && /[A-Za-z0-9,]$/.test(hook)) {
    findings.push({
      rule: 'hook_completeness',
      severity: 'info',
      message: 'Hook does not end on sentence punctuation; check it reads as a complete thought at the fold.',
      passed: true
    })
  }

  // 3. Markdown — LinkedIn renders none of it
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
          message: `LinkedIn shows markdown as literal characters. Found: ${detectedMarkdown.join(', ')}.`,
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
  const urlsInBody = fullText.match(/https?:\/\/[^\s]+/gi) || []
  const strategy = opts.linkPlacement || 'first_comment'
  findings.push(
    strategy === 'first_comment' && urlsInBody.length > 0
      ? {
          rule: 'link_placement',
          severity: 'warning',
          message: `External links in the body reduce reach: ${urlsInBody.slice(0, 3).join(', ')}. Move them to the first comment.`,
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
    new RegExp(`\\b${escapeRegex(word)}\\b`, 'i').test(fullText)
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
      new RegExp(`\\b${escapeRegex(topic)}\\b`, 'i').test(fullText)
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

  // 10. Engagement bait
  const engagementBait =
    /\b(comment\s+["']?yes["']?|type\s+["']?yes["']?|tag\s+a\s+friend|tag\s+someone\s+who|share\s+if\s+you\s+agree|smash\s+that\s+like)\b/i
  if (engagementBait.test(fullText)) {
    findings.push({
      rule: 'engagement_bait',
      severity: 'error',
      message: 'Engagement bait detected. LinkedIn penalises posts that ask for interactions this way.',
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

  return findings
}
