import 'server-only'

import { isAICapable } from '@/lib/ai'
import { isWebSearchConfigured, searchWeb } from '@/lib/research/web-search'
import { UnsafeUrlError } from '@/lib/safe-url'
import {
  looksLikePlaceholderPage,
  scrapeHtml,
  scrapeUrl,
  type ScrapedContent
} from '@/lib/scraper'
import { markdownLinks, withUnseenLinks } from '@/lib/site-links'
import { normalizeUrlForCompare } from '@/lib/urls'
import { SkillError } from '../run-skill'
import { suggestSetup, type SetupSource } from '../skills/profile-setup'
import { findEntity } from '../skills/profile-setup/entity'
import { pickLinks } from '../skills/profile-setup/link-pick'
import { pickSitePages } from '../skills/profile-setup/page-pick'
import {
  AnalyzeIdentityInputSchema,
  hasAnySuggestion,
  type AnalyzeIdentityInput,
  type IdentitySetupAnalysis,
  type SourceFetchStatus
} from '../skills/profile-setup/schema'
import { researchIdentity, type ResearchResult } from './identity-research'
import { readSitePages } from './site-pages'

/**
 * AI setup ("Describe yourself once"): fetch the pages the user named, run the
 * profile-setup skill over them, and turn failures into messages the user can
 * act on. Read-only; the review dialog decides what gets saved.
 */

/** Per-page cap on what the model sees; the scraper already caps at 50k. */
const SOURCE_PROMPT_CHARS = 8000
/**
 * A website's homepage gets more: its product sections, menus and footer list
 * what the business sells, and 8000 characters cut off half of a big one.
 */
const SITE_HOME_PROMPT_CHARS = 16_000
/** A slow website should not hold up the analysis; the description is enough. */
const SOURCE_FETCH_TIMEOUT_MS = 8000
/** A single search that hangs must not hold up the analysis. */
const SEARCH_TIMEOUT_MS = 8000
/**
 * Web research as a whole (finding who to look up, searching, the AI's pick of
 * links, reading pages); past this the analysis goes ahead without it.
 */
const RESEARCH_BUDGET_MS = 40_000
/**
 * Reading the website's product pages (the AI's pick, then the fetches); past
 * this the analysis goes ahead with the homepage alone.
 */
const SITE_PAGES_BUDGET_MS = 25_000

export class IdentitySetupError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'IdentitySetupError'
  }
}

/**
 * LinkedIn serves a sign-in wall to logged-out fetches, which scrapes fine but
 * says nothing about the person. Treat it as unavailable rather than as data.
 */
function looksLikeLoginWall(url: string, title: string, content: string) {
  if (!/(^|\.)linkedin\.com$/i.test(new URL(url).hostname)) return false
  const words = content.split(/\s+/).filter(Boolean).length
  return (
    /\b(sign in|sign up|log in|join now|authwall)\b/i.test(title) ||
    (words < 300 && /\b(sign in|join now|agree & join)\b/i.test(content))
  )
}

/** `work`'s result, or `fallback` once `ms` pass or if it fails. */
async function settleWithin<T>(
  work: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>(resolve => {
        timer = setTimeout(() => resolve(fallback), ms)
      })
    ])
  } catch {
    return fallback
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Reads a page.
 *
 * `direct` (a page of their own site) also reads its HTML alongside the
 * reader scrapeUrl prefers, which is slow under load: when the reader runs
 * out of time, the HTML's text is used instead of losing the page.
 *
 * `links` (their website's homepage) implies `direct` and also keeps the
 * page's links. Its text is what is on screen, so a product menu that opens
 * on a click is missing from it; the links the text does not show are put
 * before it, so the AI and the guard's checks both read them as the site's
 * own words.
 */
async function fetchSource(
  url: string,
  kind: SourceFetchStatus['kind'],
  options: { direct?: boolean; links?: boolean } = {}
): Promise<SetupSource> {
  // Logged-out requests to LinkedIn get a sign-in wall, and trying costs
  // several seconds, so the description is used instead.
  if (kind === 'linkedin') {
    return {
      status: {
        url,
        kind,
        status: 'unavailable',
        reason:
          'LinkedIn requires signing in, so your description was used instead.'
      }
    }
  }

  // Fetched alongside the page, within the same time.
  const html =
    options.direct || options.links
      ? settleWithin(scrapeHtml(url), SOURCE_FETCH_TIMEOUT_MS, null)
      : Promise.resolve(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    let page: ScrapedContent
    try {
      page = await Promise.race([
        scrapeUrl(url),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timeout')),
            SOURCE_FETCH_TIMEOUT_MS
          )
        })
      ])
    } catch (error) {
      const fallback = (await html)?.page
      if (!fallback) throw error
      page = fallback
    }
    if (
      looksLikePlaceholderPage(page.title, page.content) ||
      looksLikeLoginWall(url, page.title, page.content)
    ) {
      return {
        status: {
          url,
          kind,
          status: 'unavailable',
          reason: 'The page returned an error or sign-in wall.'
        }
      }
    }
    const status: SourceFetchStatus = {
      url,
      kind,
      status: 'fetched',
      title: page.title
    }
    if (!options.links) {
      return { status, content: page.content.slice(0, SOURCE_PROMPT_CHARS) }
    }

    const text = page.content.slice(0, SITE_HOME_PROMPT_CHARS)
    const fromHtml = (await html)?.links ?? []
    // When the HTML could not be read, the links in the reader's text remain.
    const links =
      fromHtml.length > 0 ? fromHtml : markdownLinks(page.content, url)
    return { status, content: withUnseenLinks(text, links, url), links }
  } catch (error) {
    return {
      status: {
        url,
        kind,
        status: 'unavailable',
        reason:
          error instanceof UnsafeUrlError
            ? error.message
            : error instanceof Error && error.message === 'timeout'
              ? 'The page took too long to load.'
              : 'The page could not be fetched.'
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

/** One search that gives up (returning nothing) rather than hang the analysis. */
async function searchWithTimeout(query: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      searchWeb(query, { freshnessDays: 0, resultCount: 8 }),
      new Promise<never[]>(resolve => {
        timer = setTimeout(() => resolve([]), SEARCH_TIMEOUT_MS)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Looks the person or business up on the web and verifies what it finds
 * (see identity-research.ts). Never fails the analysis: any problem is
 * reported as "not verified" and the user's own details are used.
 */
async function researchOnline(
  entityLookup: Promise<Awaited<ReturnType<typeof findEntity>>>,
  input: {
    description: string
    linkedinUrl?: string
    websiteUrl?: string
  }
): Promise<ResearchResult> {
  const empty = (note: string): ResearchResult => ({
    sources: [],
    verified: {},
    notes: [note]
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () =>
        researchIdentity(
          {
            description: input.description,
            entity: await entityLookup,
            provided: {
              linkedinUrl: input.linkedinUrl,
              websiteUrl: input.websiteUrl
            }
          },
          {
            searchConfigured: isWebSearchConfigured,
            search: query => searchWithTimeout(query),
            fetchPage: (url, options) => fetchSource(url, 'web', options),
            pickLinks
          }
        ))(),
      new Promise<ResearchResult>(resolve => {
        timer = setTimeout(
          () =>
            resolve(
              empty(
                'Web research took too long, so only your details and the links you gave were used.'
              )
            ),
          RESEARCH_BUDGET_MS
        )
      })
    ])
  } catch (error) {
    console.warn('Identity web research failed:', error)
    return empty(
      'Web research could not be completed, so only your details and the links you gave were used.'
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The pages of their own website that describe what they sell, beyond its
 * homepage (see site-pages.ts). Never fails the analysis: on any problem the
 * homepage alone is used.
 */
async function readOwnSite(
  description: string,
  home: SetupSource,
  signal?: AbortSignal
): Promise<SetupSource[]> {
  if (signal?.aborted) return []
  try {
    return await settleWithin(
      readSitePages(
        { description, home },
        {
          pickPages: pickSitePages,
          fetchPage: url => fetchSource(url, 'site', { direct: true })
        }
      ),
      SITE_PAGES_BUDGET_MS,
      []
    )
  } catch (error) {
    console.warn('Reading the website beyond its homepage failed:', error)
    return []
  }
}

export async function analyzeIdentitySetup(
  input: AnalyzeIdentityInput,
  signal?: AbortSignal
): Promise<IdentitySetupAnalysis> {
  const parsed = AnalyzeIdentityInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new IdentitySetupError(
      parsed.error.issues.map(i => i.message).join(' '),
      false
    )
  }
  const { description, linkedinUrl, websiteUrl, guidance } = parsed.data

  // Checked before fetching so a missing key does not cost the page fetches.
  if (!isAICapable) {
    throw new IdentitySetupError(
      'AI is not configured. Set ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to use Analyze with AI.',
      false
    )
  }

  const requested: Array<[string, SourceFetchStatus['kind']]> = []
  if (linkedinUrl) requested.push([linkedinUrl, 'linkedin'])
  if (websiteUrl) requested.push([websiteUrl, 'website'])
  // Working out who to look up overlaps with reading the pages the user gave.
  // With no type chosen, the profile is a person's unless the input is only
  // about a business, and a requested "personal" settles the lookup the same
  // way: the person when they write about themselves and their business, the
  // business when it is all the input describes.
  const entityLookup = isWebSearchConfigured
    ? findEntity(description, guidance?.accountType ?? 'personal')
    : Promise.resolve(null)
  const providedSources: SetupSource[] = await Promise.all(
    requested.map(([url, kind]) =>
      fetchSource(url, kind, { links: kind === 'website' })
    )
  )
  // The website they gave is explored while research runs.
  const providedSite = providedSources.find(s => s.status.kind === 'website')
  const [research, providedSitePages] = await Promise.all([
    researchOnline(entityLookup, {
      description,
      linkedinUrl,
      websiteUrl
    }),
    providedSite
      ? readOwnSite(description, providedSite, signal)
      : Promise.resolve([])
  ])
  // A website research found is explored once research has read it.
  const verifiedSite = research.verified.websiteUrl
  const foundSite =
    !providedSite && verifiedSite
      ? research.sources.find(
          s =>
            normalizeUrlForCompare(s.status.url) ===
            normalizeUrlForCompare(verifiedSite.url)
        )
      : undefined
  const sitePages = foundSite
    ? await readOwnSite(description, foundSite, signal)
    : providedSitePages
  // Pages found by search come after the user's own, then the pages of their
  // site read for its offerings; each is labelled as such.
  const sources: SetupSource[] = [
    ...providedSources,
    ...research.sources,
    ...sitePages
  ]
  // Cancelled while reading pages: skip the model call and its cost.
  if (signal?.aborted) {
    throw new IdentitySetupError('The analysis was cancelled.', true)
  }

  let result: Awaited<ReturnType<typeof suggestSetup>>
  try {
    result = await suggestSetup({
      description,
      sources,
      providedUrls: requested.map(([url]) => url),
      guidance,
      research: { verified: research.verified, notes: research.notes },
      signal
    })
  } catch (error) {
    console.error('Account Setup analysis failed:', error)
    if (error instanceof SkillError && error.reason === 'quota_exceeded') {
      // Retrying cannot help until the key's budget is raised or replaced.
      throw new IdentitySetupError(
        'The AI usage limit for this app has been reached (AI Gateway budget exhausted). Please ask an admin to raise the limit or replace the AI_GATEWAY_API_KEY, then try again.',
        false
      )
    }
    throw new IdentitySetupError(
      error instanceof SkillError && error.reason === 'timeout'
        ? 'The analysis took too long. Please try again.'
        : 'The AI could not complete the analysis. Please try again.',
      true
    )
  }

  if (!hasAnySuggestion(result.suggestions)) {
    throw new IdentitySetupError(
      'There was not enough information to suggest anything. Add more detail about who you are, who you serve and what you offer, then try again.',
      true
    )
  }

  return {
    accountType: result.accountType,
    suggestions: result.suggestions,
    warnings: result.warnings,
    sources: sources.map(s => s.status),
    modelUsed: result.modelUsed
  }
}
