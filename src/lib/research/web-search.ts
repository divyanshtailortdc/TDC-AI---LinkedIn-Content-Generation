import 'server-only'

import { env } from '~/env'
import type { GenerationContext } from '~/lib/ai/context'
import { inferRegion } from '~/lib/ai/region'
import { stripTrackingParams } from '~/lib/urls'
import { interleave } from '~/lib/ai/pipeline/grounding-corpus'
import {
  buildSearchQueries,
  normalizePublishedDate,
  searchCountFor
} from './findings'

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
  /** YYYY-MM-DD, fixed when the result was fetched; absent when undated. */
  publishedAt?: string
}

export const isWebSearchConfigured = Boolean(env.SERPER_API_KEY)

/** Searches a fixed-research run has in flight at once. */
const SEARCH_CONCURRENCY = 4

/** Serper's freshness operator, derived from the configured window. */
function freshnessToTbs(days: number): string | undefined {
  if (!days || days <= 0) return undefined
  if (days <= 1) return 'qdr:d'
  if (days <= 7) return 'qdr:w'
  if (days <= 31) return 'qdr:m'
  if (days <= 366) return 'qdr:y'
  return undefined
}

const SEARCH_TIMEOUT_MS = 10_000

/**
 * One search. Returns no results, rather than throwing, when it fails.
 * `country` (an ISO code) asks for results from that market.
 */
export async function searchWeb(
  query: string,
  options: { freshnessDays: number; resultCount?: number; country?: string }
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
        ...(tbs ? { tbs } : {}),
        // Google's country codes are ISO ones, except "uk" for the United Kingdom.
        ...(options.country
          ? { gl: options.country === 'gb' ? 'uk' : options.country }
          : {})
      }),
      // A search that never answers would hold the run; it counts as failed.
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    })
    if (!res.ok) {
      console.warn(`Serper search failed (${res.status}) for "${query}"`)
      return []
    }
    const data = await res.json()
    const fetchedAt = new Date()
    const findings: Finding[] = []
    for (const item of data.organic || []) {
      if (!item.link || !item.title) continue
      findings.push({
        url: stripTrackingParams(item.link),
        title: item.title,
        snippet: item.snippet || '',
        provider: 'serper_search',
        publishedAt: normalizePublishedDate(item.date, fetchedAt)
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

/** `fn` over `items`, at most `limit` at a time; results in the items' order. */
export async function mapConcurrently<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  )
  return results
}

/**
 * Fixed research: the queries above, a few at a time, at least one per goal
 * picked for the run. Results are taken from each query in turn, so the
 * evidence the prompt shows covers every goal rather than the first query's.
 */
export async function runWebSearch(
  ctx: GenerationContext,
  onQuery: (q: string) => void
): Promise<Finding[]> {
  const policy = ctx.prefs.research
  if (!policy.use_web_search) return []
  if (!env.SERPER_API_KEY) return []

  const region = inferRegion(ctx)
  const queries = buildSearchQueries(ctx, searchCountFor(ctx), region)
  const perQuery = await mapConcurrently(queries, SEARCH_CONCURRENCY, query => {
    onQuery(query)
    return searchWeb(query, {
      freshnessDays: policy.freshness_days,
      country: region?.code
    })
  })
  return dedupeFindings(interleave(perQuery))
}
