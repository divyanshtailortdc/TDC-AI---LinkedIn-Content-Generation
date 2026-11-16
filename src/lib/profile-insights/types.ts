import type { PlatformId } from '../platforms'

/**
 * What an identity's public profile on one platform shows about how it posts
 * there: its subjects, its writing, its captions and hashtags, how its posts
 * look and which formats it uses. Learned from its own posts
 * (./analyze.ts), shown and edited on the Profile page, and read by ideation,
 * drafting and the image brief for that platform.
 *
 * Free of dependencies beyond types, so the schema (its check constraint),
 * the server and the browser all read the same definitions.
 */

/**
 * analyzing: an analysis is running. ready: the latest one succeeded.
 * unavailable: too little could be read from the profile (private, new, not
 * indexed, a link that names no account). failed: something broke (the AI
 * could not be reached); trying again may work.
 */
export const INSIGHT_STATUSES = [
  'analyzing',  
  'ready',
  'unavailable',
  'failed'
] as const
export type InsightStatus = (typeof INSIGHT_STATUSES)[number]

/** A subject the account keeps posting about. */
export type InsightTheme = { name: string; description: string }

/** A kind of post the account makes (Reels, carousels, threads...), and how. */
export type InsightFormat = { format: string; note: string }

export type ProfileInsights = {
  /** Two or three sentences: what the account posts and how. */
  summary: string
  themes: InsightTheme[]
  /** How posts are written: openings, length, structure, closings. */
  writingStyle: string
  tone: string
  /** Caption habits: length, line breaks, calls to action, emoji, language mix. */
  captions: string
  /** The account's recurring hashtags, most used first, each with its #. */
  hashtags: string[]
  /** How it uses hashtags: how many, where, branded or general. */
  hashtagUsage: string
  /** How its posts look: imagery, colours, people, text on images. Empty when unseen. */
  visualIdentity: string
  formats: InsightFormat[]
}

/** Where a post was read from: the search index's public copy, or the identity's Buffer channel. */
export type InsightPostSource = 'search' | 'buffer'

/** One of the account's posts an analysis read. */
export type InsightPost = {
  url: string
  /** What could be read of it; a search result usually shows only its opening. */
  text: string
  /** 'post', 'reel', 'video', 'photo', 'thread'... as the platform's address says. */
  kind: string
  /** YYYY-MM-DD, when known. */
  date?: string
  source: InsightPostSource
  /** True when only part of the text could be read. */
  partial: boolean
  /**
   * True when the text lost its capitals and punctuation on the way (a
   * LinkedIn post's opening read from its address): its words count, its
   * case and punctuation do not.
   */
  wordsOnly?: boolean
  /** The image's shape, "4:5" or "1:1", when one was seen. */
  aspect?: string
}

/** How much each source gave the latest analysis. */
export type InsightSources = {
  search?: number
  buffer?: number
  images?: number
}

/** An identity's analysis of one platform, as the Profile page shows it. */
export type ProfileInsightView = {
  platform: PlatformId
  profileUrl: string
  status: InsightStatus
  error: string | null
  insights: ProfileInsights | null
  posts: InsightPost[]
  sources: InsightSources
  /** ISO times, for the browser. */
  analyzedAt: string | null
  editedAt: string | null
}

/** Platforms whose public posts can be looked up; YouTube's are videos. */
export const ANALYZABLE_PLATFORMS: readonly PlatformId[] = [
  'linkedin',
  'x',
  'threads',
  'facebook',
  'instagram'
]

export const isAnalyzablePlatform = (platform: PlatformId) =>
  ANALYZABLE_PLATFORMS.includes(platform)

/**
 * An analysis takes a minute or two. One still 'analyzing' after this was
 * cut off (the server restarted) and may be started again.
 */
export const ANALYSIS_STALE_MS = 6 * 60_000

/** The status to show: an analysis cut off reads as failed. */
export function effectiveStatus(
  row: { status: InsightStatus; startedAt: Date | string | null },
  now = Date.now()
): InsightStatus {
  if (row.status !== 'analyzing') return row.status
  const started = row.startedAt ? new Date(row.startedAt).getTime() : 0
  return now - started > ANALYSIS_STALE_MS ? 'failed' : 'analyzing'
}

export const INTERRUPTED_MESSAGE =
  'The analysis was interrupted before it finished. Try again.'

/** The longest each field is kept, for the model's answer and for edits alike. */
export const INSIGHT_LIMITS = {
  summary: 700,
  writingStyle: 1500,
  tone: 400,
  captions: 1000,
  hashtagUsage: 400,
  visualIdentity: 1000,
  themes: 8,
  themeName: 80,
  themeDescription: 300,
  formats: 6,
  formatName: 60,
  formatNote: 300,
  hashtags: 20,
  hashtag: 50
} as const

const text = (value: unknown, max: number): string =>
  typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').trim().slice(0, max).trim()
    : ''

/** "#FoodLover" from "foodlover"-ish input; null when nothing usable is left. */
export function normalizeHashtag(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // Letters (with their marks) and digits of any script, and underscores:
  // what platforms link.
  const tag = value
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{M}\p{N}_]/gu, '')
  return tag ? `#${tag.slice(0, INSIGHT_LIMITS.hashtag)}` : null
}

function pairs<K extends string, V extends string>(
  value: unknown,
  keys: [K, V],
  limits: [number, number],
  count: number
): Array<Record<K | V, string>> {
  if (!Array.isArray(value)) return []
  const out: Array<Record<K | V, string>> = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = text(record[keys[0]], limits[0])
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({
      [keys[0]]: name,
      [keys[1]]: text(record[keys[1]], limits[1])
    } as Record<K | V, string>)
    if (out.length >= count) break
  }
  return out
}

/**
 * Insights as they may be kept: every field present, trimmed and within its
 * limit, hashtags with one # each and no repeats. The model's answer, a
 * user's edit and a saved row all pass through here. Null when nothing is
 * left to say.
 */
export function cleanProfileInsights(value: unknown): ProfileInsights | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const hashtags: string[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw.hashtags) ? raw.hashtags : []) {
    const tag = normalizeHashtag(item)
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    hashtags.push(tag)
    if (hashtags.length >= INSIGHT_LIMITS.hashtags) break
  }
  const insights: ProfileInsights = {
    summary: text(raw.summary, INSIGHT_LIMITS.summary),
    themes: pairs(
      raw.themes,
      ['name', 'description'],
      [INSIGHT_LIMITS.themeName, INSIGHT_LIMITS.themeDescription],
      INSIGHT_LIMITS.themes
    ),
    writingStyle: text(raw.writingStyle, INSIGHT_LIMITS.writingStyle),
    tone: text(raw.tone, INSIGHT_LIMITS.tone),
    captions: text(raw.captions, INSIGHT_LIMITS.captions),
    hashtags,
    hashtagUsage: text(raw.hashtagUsage, INSIGHT_LIMITS.hashtagUsage),
    visualIdentity: text(raw.visualIdentity, INSIGHT_LIMITS.visualIdentity),
    formats: pairs(
      raw.formats,
      ['format', 'note'],
      [INSIGHT_LIMITS.formatName, INSIGHT_LIMITS.formatNote],
      INSIGHT_LIMITS.formats
    )
  }
  const empty =
    !insights.summary &&
    !insights.writingStyle &&
    !insights.tone &&
    !insights.captions &&
    !insights.visualIdentity &&
    !insights.hashtagUsage &&
    insights.themes.length === 0 &&
    insights.formats.length === 0 &&
    insights.hashtags.length === 0
  return empty ? null : insights
}

/**
 * Themes or formats as the editor shows them, one per line: "Name: what it is".
 * pairsFromLines reads them back.
 */
export function linesFromPairs(
  items: Array<{ name: string; detail: string }>
): string {
  return items
    .map(i => (i.detail ? `${i.name}: ${i.detail}` : i.name))
    .join('\n')
}

/** Lines typed as "Name: what it is" (or just a name), blank lines skipped. */
export function pairsFromLines(
  value: string
): Array<{ name: string; detail: string }> {
  return value
    .split('\n')
    .map(line => line.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean)
    .map(line => {
      const at = line.indexOf(':')
      return at > 0
        ? { name: line.slice(0, at).trim(), detail: line.slice(at + 1).trim() }
        : { name: line, detail: '' }
    })
}

/** Hashtags typed with spaces, commas or new lines between them. */
export function hashtagsFromText(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map(normalizeHashtag)
    .filter((tag): tag is string => Boolean(tag))
}
