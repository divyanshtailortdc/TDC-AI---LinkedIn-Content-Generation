import { styleMixFor, type GenerationContext } from '~/lib/ai/context-blocks'
import type { Region } from '~/lib/ai/region'
import type { StyleMix } from '~/lib/formats/styles'
import type { PlatformId } from '~/lib/platforms'
import { learnedSubjects } from '~/lib/profile-insights/render'
import type { SignalKind } from './source-credibility'

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

/** The most searches fixed research makes in one run. */
const MAX_SEARCHES_PER_RUN = 12

/**
 * How many searches fixed research makes: the research setting, raised so
 * every goal picked for the run gets a query of its own.
 */
export function searchCountFor(
  ctx: Pick<GenerationContext, 'prefs' | 'selectedGoals'>
): number {
  return Math.min(
    Math.max(
      ctx.prefs.research.max_searches_per_run || 3,
      ctx.selectedGoals.length,
      1
    ),
    MAX_SEARCHES_PER_RUN
  )
}

/** Longest key message used as a search subject, in words. */
const SUBJECT_WORDS = 12

/** A key message as a search subject: its first sentence, cut to a few words. */
function asSubject(text: string): string {
  const sentence = text.trim().split(/(?<=[.!?;:])\s/)[0] ?? ''
  return sentence
    .replace(/[.!?;:]+$/, '')
    .split(/\s+/)
    .slice(0, SUBJECT_WORDS)
    .join(' ')
}

/**
 * Research for casual and fun platforms is what is going on in the author's
 * topic, not news about a business: trends, challenges and what people there
 * are making now, then the run's goals in the topic's words.
 */
function trendSearchQueries(
  ctx: GenerationContext,
  limit: number,
  region?: Region | null
): string[] {
  const a = ctx.account
  const niche = (a.industry || a.headline || a.name).split(/[,;/|\n]/)[0]!.trim()
  const place = region?.code ? ` ${region.name}` : ''
  // Not "viral video ideas": that found listicles of the most generic ideas
  // there are, which then came back as this account's ideas.
  const queries = [
    `${niche} trend this week`,
    `${niche} challenge trending`,
    `${niche} viral this week`,
    ...ctx.selectedGoals.map(g => `${niche} ${goalSubject(g) ?? g.title}`)
  ].map(q => `${q}${place}`.replace(/\s+/g, ' ').trim())
  return Array.from(new Set(queries)).slice(0, limit)
}

/** Goals about reach and reactions rather than a subject. */
const SOCIAL_OBJECTIVES = new Set(['engagement', 'entertain', 'community', 'grow_audience'])

/**
 * What to search for a goal. "Promote Zomato Gold" searches "Zomato Gold".
 * A goal about reactions ("Make people smile and share food moments") names
 * no subject a search can find; it searches for what of the brand's is going
 * viral instead. Other titles are searched as written.
 */
function goalSubject(goal: GenerationContext['selectedGoals'][number]): string | null {
  const title = goal.title.trim()
  const promoted = /^(?:promote|showcase|highlight|announce|launch|introduce)\s+(.{3,})$/i.exec(title)
  if (promoted) return promoted[1]!
  if (SOCIAL_OBJECTIVES.has(goal.objective)) return 'viral'
  return null
}

/** A query against Serper's web search or its news search. */
export type ResearchQuery = {
  query: string
  endpoint: 'search' | 'news'
  freshnessDays: number
  kind: SignalKind
}

/** How far back the trend scan looks: a trend is this week's. */
export const TREND_DAYS = 7
/** Conversations move slower than news; a month of them. */
export const CONVERSATION_DAYS = 31

/** The account's own subjects (learned from its posts) searched in the news each run. */
export const LEARNED_SUBJECT_SEARCHES = 2

/**
 * The trend scan: what is happening now around this account, for ideas that
 * ride it. Run beside the research for the goals, whichever mode that is.
 *
 * - the brand in the news this week (companies), and what its campaigns are doing
 * - its field's news this week, in the readers' market
 * - what is going viral on the run's casual platforms, and the memes of the week
 * - what people are saying about the field (Reddit threads)
 * - the subjects the account posts most about on the run's platforms, when
 *   its profiles there were analyzed (src/lib/profile-insights)
 *
 * Every query names the readers' market when there is one, and the news
 * search only returns indexed news sites, dated.
 */
export function planTrendScan(
  ctx: GenerationContext,
  options: {
    /** The run's platforms by name ("Instagram"); empty for LinkedIn alone. */
    platforms: string[]
    /** The same platforms by id, for what the account posts about there. */
    platformIds?: readonly PlatformId[]
    style: StyleMix
    region?: Region | null
  }
): ResearchQuery[] {
  const a = ctx.account
  const brand = a.accountType === 'company' ? (a.name || a.company || '').trim() : ''
  const field = (a.industry || a.headline || '').split(/[,;/|\n·]/)[0]!.trim()
  const place = options.region?.code ? ` ${options.region.name}` : ''
  const casual = options.style !== 'professional'
  const marketing = ctx.selectedGoals.some(
    g => SOCIAL_OBJECTIVES.has(g.objective) || g.objective === 'promote'
  )
  const plan: ResearchQuery[] = []
  const add = (query: string, endpoint: ResearchQuery['endpoint'], kind: SignalKind, days = TREND_DAYS) => {
    const q = query.replace(/\s+/g, ' ').trim()
    if (q && !plan.some(p => p.query === q && p.endpoint === endpoint)) {
      plan.push({ query: q, endpoint, freshnessDays: days, kind })
    }
  }

  if (brand) add(brand, 'news', 'news')
  if (field) add(`${field}${place}`, 'news', 'news')
  // What the account already posts about, in this week's news: timely angles
  // in its own world. A subject that is the brand or the field is searched above.
  const known = [brand, field].map(k => k.toLowerCase())
  for (const subject of learnedSubjects(
    ctx.platformInsights,
    options.platformIds ?? [],
    LEARNED_SUBJECT_SEARCHES + known.length
  )
    .filter(subject => !known.includes(subject.toLowerCase()))
    .slice(0, LEARNED_SUBJECT_SEARCHES)) {
    add(`${subject}${place}`, 'news', 'news')
  }
  if (brand && (casual || marketing)) add(`${brand} campaign`, 'news', 'trend', CONVERSATION_DAYS)
  if (casual) {
    for (const platform of options.platforms.slice(0, 2)) {
      add(`viral ${platform} trend${place}`, 'news', 'trend')
    }
    if (options.platforms.length === 0) add(`viral trend${place}`, 'news', 'trend')
    add(`viral meme${place}`, 'news', 'trend')
  } else if (field) {
    add(`${field} trend${place}`, 'news', 'trend')
  }
  if (field) add(`site:reddit.com ${field}${place}`, 'search', 'conversation', CONVERSATION_DAYS)
  return plan
}

/**
 * Search queries for fixed research, each anchored to the account so results
 * are about this brand or its field. Bare subjects on their own ("Innovation",
 * "Brand trust") brought back marketing advice any account could have been
 * shown.
 *
 * Subjects come from the goals picked for the run, and from no other goal:
 * every goal's title first, then their key messages, so even a few searches
 * cover each goal; then the audience's pains. Queries alternate between the
 * brand (its own developments) and its industry (new subjects around it), and
 * name the readers' country when there is one.
 */
export function buildSearchQueries(
  ctx: GenerationContext,
  limit: number,
  region?: Region | null
): string[] {
  const a = ctx.account
  // Every platform casual or fun: trends only. A mix: editorial and trend
  // searches in turn, so both kinds of idea have something to work from.
  const style = styleMixFor(ctx)
  if (style === 'casual') return trendSearchQueries(ctx, limit, region)
  // A person's name finds little; their field is the useful anchor. A
  // company is searched by the name people know it by ("Zomato"), not its
  // legal parent ("Eternal Limited").
  const brand = a.accountType === 'company' ? (a.name || a.company || '').trim() : ''
  // "Consumer electronics, semiconductors and appliances" searches as its first part.
  const field = (a.industry || '').split(/[,;/|]/)[0]!.trim()
  const anchors = [brand, field].filter(Boolean)
  if (anchors.length === 0) anchors.push((a.headline || a.name).trim())

  const goals = ctx.selectedGoals
  // A goal about reactions has no subject of its own to search, and its
  // message is a sentence about feelings; the trend scan covers it.
  const subjects = [
    ...goals.map(g => goalSubject(g) ?? g.title.trim()),
    ...goals.map(g =>
      g.keyMessage && !SOCIAL_OBJECTIVES.has(g.objective) ? asSubject(g.keyMessage) : ''
    )
  ].filter(Boolean)
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
    // "Zomato Gold" already names the brand; "Food delivery Zomato Gold" would not help.
    let query = anchors.some(known => includes(subject, known)) ? subject : `${anchor} ${subject}`
    if (place && !includes(query, place)) query = `${query} ${place}`
    return query.replace(/\s+/g, ' ').trim()
  })
  const editorial = Array.from(new Set(queries.filter(Boolean)))
  if (style !== 'mixed') return editorial.slice(0, limit)
  const trends = trendSearchQueries(ctx, limit, region)
  const both: string[] = []
  for (let i = 0; i < Math.max(editorial.length, trends.length); i++) {
    if (editorial[i]) both.push(editorial[i]!)
    if (trends[i]) both.push(trends[i]!)
  }
  return Array.from(new Set(both)).slice(0, limit)
}
