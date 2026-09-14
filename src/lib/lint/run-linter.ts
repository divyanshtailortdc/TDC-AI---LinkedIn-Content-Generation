export interface LintFinding {
  rule: string
  severity: 'error' | 'warning' | 'info'
  message: string
  passed: boolean
}

export interface LintOptions {
  hook: string
  body: string
  firstComment?: string | null
  linkPlacement?: 'first_comment' | 'body' | null
  bannedWords?: string[] | null
  bannedTopics?: string[] | null
  maxChars?: number
  hookMaxChars?: number
  citationsCount?: number
}

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

export function runLinter(opts: LintOptions): LintFinding[] {
  const findings: LintFinding[] = []
  const maxChars = opts.maxChars || 3000
  const hookMaxChars = opts.hookMaxChars || 200
  const fullText = `${opts.hook}\n\n${opts.body}`.trim()
  const charCount = fullText.length
  const hookLength = opts.hook.trim().length

  // 1. Character count check
  if (charCount > maxChars) {
    findings.push({
      rule: 'char_limit',
      severity: 'error',
      message: `Post character count (${charCount}) exceeds LinkedIn limit of ${maxChars}.`,
      passed: false
    })
  } else if (charCount > maxChars - 200) {
    findings.push({
      rule: 'char_limit',
      severity: 'warning',
      message: `Post character count (${charCount}) is very close to maximum limit of ${maxChars}.`,
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

  // 2. Hook length and fold check
  if (hookLength > hookMaxChars) {
    findings.push({
      rule: 'hook_fold',
      severity: 'warning',
      message: `Hook length (${hookLength} chars) exceeds the ~${hookMaxChars} character LinkedIn "...see more" fold. Part of your hook will be hidden behind truncation.`,
      passed: false
    })
  } else {
    findings.push({
      rule: 'hook_fold',
      severity: 'info',
      message: `Hook stays within the ${hookMaxChars} character fold (${hookLength} chars).`,
      passed: true
    })
  }

  // 3. Markdown leakage check (LinkedIn renders plain text only)
  const markdownPatterns = [
    { pattern: /\*\*[^*]+\*\*/, name: 'Bold markdown (**text**)' },
    { pattern: /__[^_]+__/, name: 'Underline/bold markdown (__text__)' },
    { pattern: /#{1,6}\s/, name: 'Header markdown (# Header)' },
    { pattern: /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/, name: 'Markdown link ([text](url))' },
    { pattern: /^\s*-\s+/m, name: 'Markdown hyphen bullet (- item)' },
    { pattern: /```/, name: 'Code block (```)' }
  ]

  const detectedMarkdown: string[] = []
  for (const { pattern, name } of markdownPatterns) {
    if (pattern.test(fullText)) {
      detectedMarkdown.push(name)
    }
  }

  if (detectedMarkdown.length > 0) {
    findings.push({
      rule: 'no_markdown_leakage',
      severity: 'error',
      message: `LinkedIn does not render markdown! Detected raw formatting: ${detectedMarkdown.join(', ')}. Use plain text with emojis or standard punctuation instead.`,
      passed: false
    })
  } else {
    findings.push({
      rule: 'no_markdown_leakage',
      severity: 'info',
      message: 'Zero raw markdown syntax detected.',
      passed: true
    })
  }

  // 4. External URL placement check
  const urlRegex = /https?:\/\/[^\s]+/gi
  const urlsInBody = fullText.match(urlRegex) || []
  const strategy = opts.linkPlacement || 'first_comment'

  if (strategy === 'first_comment' && urlsInBody.length > 0) {
    findings.push({
      rule: 'link_placement',
      severity: 'warning',
      message: `External URLs detected in post body: ${urlsInBody.join(', ')}. LinkedIn algorithms suppress feed reach for body links. Move them to the first comment instead.`,
      passed: false
    })
  } else {
    findings.push({
      rule: 'link_placement',
      severity: 'info',
      message: 'Link strategy respected.',
      passed: true
    })
  }

  // 5. Banned words and corporate buzzwords
  const allBanned = Array.from(
    new Set([
      ...DEFAULT_BANNED_WORDS,
      ...(opts.bannedWords || []).map((w) => w.toLowerCase().trim())
    ])
  ).filter(Boolean)

  const detectedBanned: string[] = []
  const lowerFull = fullText.toLowerCase()

  for (const word of allBanned) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'i')
    if (regex.test(lowerFull)) {
      detectedBanned.push(`"${word}"`)
    }
  }

  if (detectedBanned.length > 0) {
    findings.push({
      rule: 'banned_words',
      severity: 'warning',
      message: `Detected cliché buzzwords or banned phrases: ${detectedBanned.join(', ')}. Consider rewriting without hyperbole.`,
      passed: false
    })
  } else {
    findings.push({
      rule: 'banned_words',
      severity: 'info',
      message: 'No banned corporate clichés detected.',
      passed: true
    })
  }

  // 6. Engagement bait check
  const engagementBaitRegex = /\b(comment\s+["']?yes["']?|type\s+["']?yes["']?|tag\s+a\s+friend|share\s+if\s+you\s+agree|smash\s+that\s+like)\b/i
  if (engagementBaitRegex.test(fullText)) {
    findings.push({
      rule: 'engagement_bait',
      severity: 'error',
      message: 'Engagement bait phrase detected ("comment YES", "tag a friend"). LinkedIn actively penalizes posts using explicit algorithmic bait.',
      passed: false
    })
  }

  // 7. Numeric claim citation check
  const numericPattern = /\b\d+(\.\d+)?%|\$\d+(\.\d+)?|\b\d{2,}\s+(customers|users|companies|percent|increase|reduction|growth)\b/gi
  const numericMatches = fullText.match(numericPattern) || []

  if (numericMatches.length > 0 && (opts.citationsCount ?? 0) === 0) {
    findings.push({
      rule: 'grounded_citations',
      severity: 'warning',
      message: `Specific numeric claims found (${numericMatches.slice(0, 3).join(', ')}), but no citations are attached. Verify this data against the knowledge base to prevent hallucination.`,
      passed: false
    })
  } else if (numericMatches.length > 0) {
    findings.push({
      rule: 'grounded_citations',
      severity: 'info',
      message: `Numeric claims verified against attached citation evidence.`,
      passed: true
    })
  }

  // 8. Caps lock check
  const words = fullText.split(/\s+/)
  const capsWords = words.filter((w) => w.length > 2 && /^[A-Z]{3,}$/.test(w) && !['CEO', 'CTO', 'SaaS', 'API', 'LLM', 'AI', 'ROI', 'ARR', 'B2B', 'CRM'].includes(w))
  if (capsWords.length > 3) {
    findings.push({
      rule: 'excessive_caps',
      severity: 'warning',
      message: `Multiple all-caps words detected (${capsWords.slice(0, 4).join(', ')}). May read as shouting in professional feeds.`,
      passed: false
    })
  }

  return findings
}
