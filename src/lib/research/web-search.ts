import 'server-only'

import { env } from '~/env'
import type { GenerationContext } from '~/lib/ai/context'

/**
 * Web research over Serper (Google results). Plain code, no model: the fixed
 * research mode runs these queries as is, and the research agent calls
 * `searchWeb` as one of its tools.
 */

export type Finding = {
  url: string
  title: string
  snippet: string
  provider: string
  publishedAt?: string
}

export const isWebSearchConfigured = Boolean(env.SERPER_API_KEY)

/** Serper's freshness operator, derived from the configured window. */
function freshnessToTbs(days: number): string | undefined {
  if (!days || days <= 0) return undefined
  if (days <= 1) return 'qdr:d'
  if (days <= 7) return 'qdr:w'
  if (days <= 31) return 'qdr:m'
  if (days <= 366) return 'qdr:y'
  return undefined
}

/**
 * Search queries come from what the account is actually trying to say, not a
 * fixed template. Previously every run searched
 * "<goal title> industry trends insights 2026".
 */
export function buildSearchQueries(
  ctx: GenerationContext,
  limit: number
): string[] {
  const queries: string[] = []
  const goal = ctx.primaryGoal

  if (goal?.keyMessage) queries.push(goal.keyMessage)
  if (goal?.title) queries.push(goal.title)

  for (const pillar of ctx.prefs.pillars) {
    if (queries.length >= limit + 2) break
    const topics = pillar.example_topics || []
    queries.push(
      topics.length > 0 ? `${pillar.name} ${topics[0]}` : pillar.name
    )
  }

  for (const audience of ctx.audiences) {
    if (queries.length >= limit + 2) break
    const pain = (audience.painPoints || [])[0]
    if (pain) queries.push(pain)
  }

  if (queries.length === 0) {
    queries.push(ctx.account.headline || ctx.account.name)
  }

  return Array.from(new Set(queries.map(q => q.trim()).filter(Boolean))).slice(
    0,
    limit
  )
}

/** One search. Returns no results, rather than throwing, when it fails. */
export async function searchWeb(
  query: string,
  options: { freshnessDays: number; resultCount?: number }
): Promise<Finding[]> {
  if (!env.SERPER_API_KEY) return []
  const tbs = freshnessToTbs(options.freshnessDays)
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': env.SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: query,
        num: options.resultCount ?? 5,
        ...(tbs ? { tbs } : {})
      })
    })
    if (!res.ok) {
      console.warn(`Serper search failed (${res.status}) for "${query}"`)
      return []
    }
    const data = await res.json()
    const findings: Finding[] = []
    for (const item of data.organic || []) {
      if (!item.link || !item.title) continue
      findings.push({
        url: item.link,
        title: item.title,
        snippet: item.snippet || '',
        provider: 'serper_search',
        publishedAt: item.date
      })
    }
    return findings
  } catch (err) {
    console.warn(`Serper search error for "${query}":`, err)
    return []
  }
}

/** The same URL can surface across queries; keeps the first. */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>()
  return findings.filter(f => {
    if (seen.has(f.url)) return false
    seen.add(f.url)
    return true
  })
}

/** Fixed research: the queries above, run one after another. */
export async function runWebSearch(
  ctx: GenerationContext,
  onQuery: (q: string) => void
): Promise<Finding[]> {
  const policy = ctx.prefs.research
  if (!policy.use_web_search) return []
  if (!env.SERPER_API_KEY) return []

  const maxSearches = Math.max(1, Math.min(policy.max_searches_per_run || 3, 8))
  const findings: Finding[] = []
  for (const query of buildSearchQueries(ctx, maxSearches)) {
    onQuery(query)
    findings.push(
      ...(await searchWeb(query, { freshnessDays: policy.freshness_days }))
    )
  }
  return dedupeFindings(findings)
}
