import type { GenerationContext } from '~/lib/ai/context-blocks'
import type { Region } from '~/lib/ai/region'

/**
 * The pure half of web research: what to search for and how old a result is.
 * No network access, so tests can import it; ./web-search runs the searches.
 */

const DAY_MS = 86_400_000

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
]

const isoDay = (date: Date) => date.toISOString().slice(0, 10)

/**
 * A search result's date as YYYY-MM-DD, or undefined when there is none or it
 * cannot be read. Serper gives "3 days ago" or "Oct 12, 2026"; a relative date
 * is only true on the day it was fetched, so it is fixed against `now` then.
 */
export function normalizePublishedDate(
  raw: string | null | undefined,
  now: Date
): string | undefined {
  const text = raw?.trim().toLowerCase()
  if (!text) return undefined

  const relative = /^(\d+|an?|one)\s+(minute|hour|day|week|month|year)s?\s+ago$/.exec(text)
  if (relative || text === 'yesterday' || text === 'today') {
    const count = relative ? Number(relative[1]) || 1 : text === 'yesterday' ? 1 : 0
    const unit = relative?.[2] ?? 'day'
    const date = new Date(now)
    if (unit === 'minute' || unit === 'hour') {
      date.setTime(now.getTime() - count * (unit === 'hour' ? 3_600_000 : 60_000))
    } else if (unit === 'day' || unit === 'week') {
      date.setUTCDate(date.getUTCDate() - count * (unit === 'week' ? 7 : 1))
    } else if (unit === 'month') {
      date.setUTCMonth(date.getUTCMonth() - count)
    } else {
      date.setUTCFullYear(date.getUTCFullYear() - count)
    }
    return isoDay(date)
  }

  let year: number, month: number, day: number
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  // "oct 12, 2026" or "12 oct 2026"
  const named =
    /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text) ??
    /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/.exec(text)
  if (iso) {
    ;[year, month, day] = [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])]
  } else if (named) {
    const [a, b] = /^\d/.test(named[1]!) ? [named[2]!, named[1]!] : [named[1]!, named[2]!]
    ;[year, month, day] = [Number(named[3]), MONTHS.indexOf(a), Number(b)]
  } else {
    return undefined
  }
  const date = new Date(Date.UTC(year, month, day))
  if (
    month < 0 ||
    Number.isNaN(date.getTime()) ||
    date.getUTCDate() !== day ||
    // A date in the future is a misread, not news.
    date.getTime() > now.getTime() + DAY_MS
  ) {
    return undefined
  }
  return isoDay(date)
}

/** True when a YYYY-MM-DD date falls within the last `days` days. */
export function isRecent(
  publishedAt: string | null | undefined,
  days: number,
  now: Date
): boolean {
  if (!publishedAt || days <= 0) return false
  const time = Date.parse(`${publishedAt.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(time)) return false
  const age = now.getTime() - time
  return age >= -DAY_MS && age <= (days + 1) * DAY_MS
}

/**
 * Search queries for fixed research, each anchored to the account so results
 * are about this brand or its field. Previously the queries were the goal's
 * sentence and bare pillar names ("Innovation", "Brand trust"), which brought
 * back marketing advice any account could have been shown.
 *
 * Subjects are the pillars' first topics, heaviest pillar first, then the goal
 * and the audience's pains. Queries alternate between the brand (its own
 * developments) and its industry (new subjects around it), and name the
 * readers' country when there is one.
 */
export function buildSearchQueries(
  ctx: GenerationContext,
  limit: number,
  region?: Region | null
): string[] {
  const a = ctx.account
  // A person's name finds little; their field is the useful anchor.
  const brand = a.accountType === 'company' ? (a.company || a.name).trim() : ''
  // "Consumer electronics, semiconductors and appliances" searches as its first part.
  const field = (a.industry || '').split(/[,;/|]/)[0]!.trim()
  const anchors = [brand, field].filter(Boolean)
  if (anchors.length === 0) anchors.push((a.headline || a.name).trim())

  const subjects = [...ctx.prefs.pillars]
    .sort((x, y) => (y.weight_pct || 0) - (x.weight_pct || 0))
    .map(p => (p.example_topics || []).find(t => t.trim()) || p.name)
  if (ctx.primaryGoal?.title) subjects.push(ctx.primaryGoal.title)
  for (const audience of ctx.audiences) {
    const pain = (audience.painPoints || [])[0]
    if (pain) subjects.push(pain)
  }
  if (subjects.length === 0) subjects.push('news')

  const place = region?.code ? region.name : ''
  const includes = (text: string, part: string) =>
    text.toLowerCase().includes(part.toLowerCase())

  const queries = subjects.map((subject, i) => {
    const anchor = anchors[i % anchors.length]!
    let query = includes(subject, anchor) ? subject : `${anchor} ${subject}`
    if (place && !includes(query, place)) query = `${query} ${place}`
    return query.replace(/\s+/g, ' ').trim()
  })
  return Array.from(new Set(queries.filter(Boolean))).slice(0, limit)
}
