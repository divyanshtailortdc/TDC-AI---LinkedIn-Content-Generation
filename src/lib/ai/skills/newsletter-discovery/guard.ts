import { signupUrlKey } from '@/lib/newsletters/candidates'
import type { NewsletterCategory } from '@/lib/newsletters/status'
import {
  MAX_QUERIES,
  MIN_RELEVANCE,
  type ClassificationModelOutput,
  type SearchQueriesModelOutput
} from './schema'

/** A page discovery fetched and found a way to subscribe on. */
export type VerifiedCandidate = {
  /** The page with the subscribe form, after redirects. */
  signupUrl: string
  websiteUrl: string
  title: string
  siteName: string | null
  description: string
  excerpt: string
  /** form: an email field; platform: a newsletter host; page: a newsletter page whose form loads in the browser. */
  signupEvidence: 'form' | 'platform' | 'page'
  feed: { url: string; type: 'rss' | 'atom' } | null
}

export type ClassifiedNewsletter = {
  name: string
  publisher: string
  description: string
  category: NewsletterCategory
  topics: string[]
  relevanceScore: number
  reason: string
  signupUrl: string
  signupUrlKey: string
  websiteUrl: string
  feed: VerifiedCandidate['feed']
}

const NEWSLETTER_WORD = /newsletter|subscribe|briefing|digest/i

/**
 * Trims, drops empty and repeated queries, and makes sure each one asks for a
 * newsletter, so a bare topic search does not fill the candidates with articles.
 */
export function keepValidQueries(output: SearchQueriesModelOutput): string[] {
  const seen = new Set<string>()
  const queries: string[] = []
  for (const { query } of output.queries) {
    let q = query.replace(/\s+/g, ' ').trim().slice(0, 150)
    if (!q) continue
    if (!NEWSLETTER_WORD.test(q)) q = `${q} newsletter`
    const key = q.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    queries.push(q)
  }
  return queries.slice(0, MAX_QUERIES)
}

function clean(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Name and site together, so two pages for one newsletter count once. */
export function newsletterIdentityKey(
  n: Pick<ClassifiedNewsletter, 'name' | 'websiteUrl'>
): string {
  let host = ''
  try {
    host = new URL(n.websiteUrl).hostname.replace(/^www\./, '')
  } catch {}
  return `${n.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()}@${host}`
}

/**
 * The model's verdicts, checked against the candidates it was shown. A verdict
 * for a candidate that does not exist, a second verdict for one, anything not
 * judged a newsletter and anything below MIN_RELEVANCE are dropped. URLs always
 * come from the verified candidate, never from the model.
 */
export function keepClassifiedNewsletters(
  output: ClassificationModelOutput,
  candidates: VerifiedCandidate[]
): ClassifiedNewsletter[] {
  const judged = new Set<number>()
  const kept: ClassifiedNewsletter[] = []
  for (const verdict of output.newsletters) {
    const index = verdict.candidate - 1
    if (!Number.isInteger(index) || judged.has(index)) continue
    const candidate = candidates[index]
    if (!candidate) continue
    judged.add(index)
    if (!verdict.isNewsletter) continue

    const score = Math.round(Math.min(100, Math.max(0, verdict.relevanceScore)))
    if (!Number.isFinite(score) || score < MIN_RELEVANCE) continue

    const name = clean(verdict.name, 120) || clean(candidate.title, 120)
    const publisher =
      clean(verdict.publisher, 120) || candidate.siteName || name
    const description =
      clean(verdict.description, 400) || clean(candidate.description, 400)
    if (!name || !description) continue

    kept.push({
      name,
      publisher: clean(publisher, 120),
      description,
      category: verdict.category,
      topics: [
        ...new Set(verdict.topics.map(t => clean(t, 40)).filter(Boolean))
      ].slice(0, 5),
      relevanceScore: score,
      reason: clean(verdict.reason, 300),
      signupUrl: candidate.signupUrl,
      signupUrlKey: signupUrlKey(candidate.signupUrl),
      websiteUrl: candidate.websiteUrl,
      feed: candidate.feed
    })
  }
  return dedupeNewsletters(kept)
}

/**
 * One entry per signup page and per newsletter name on a site, keeping the
 * best-scored; best first.
 */
export function dedupeNewsletters(
  items: ClassifiedNewsletter[]
): ClassifiedNewsletter[] {
  const sorted = [...items].sort((a, b) => b.relevanceScore - a.relevanceScore)
  const seenUrls = new Set<string>()
  const seenNames = new Set<string>()
  return sorted.filter(item => {
    const name = newsletterIdentityKey(item)
    if (seenUrls.has(item.signupUrlKey) || seenNames.has(name)) return false
    seenUrls.add(item.signupUrlKey)
    seenNames.add(name)
    return true
  })
}
