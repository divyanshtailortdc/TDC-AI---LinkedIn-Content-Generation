import type { Idea } from '@/db/schema'
import { countWords } from '@/lib/blogs/doc'
import { sourceQuotes, type BlogSource } from '@/lib/blogs/types'
import {
  rateSource,
  screenFindings,
  type SourceRating
} from '@/lib/research/source-credibility'
import type { Finding } from '@/lib/research/web-search'
import { normalizeUrlForCompare } from '@/lib/urls'
import type { GenerationContext } from '../context-blocks'
import type { KnowledgePassage } from '../embeddings'
import { extractNumbers } from '../skills/ideation/guard'
import { accountTextOf } from './grounding-corpus'

/**
 * A blog's evidence pool, built from research findings, an idea's evidence
 * and knowledge-base passages. Pure: ./blog-evidence.ts gathers the inputs.
 */

export const MAX_WEB_SOURCES = 10
export const MAX_KNOWLEDGE_SOURCES = 8
/** Knowledge passages shorter than this, once cleaned, say nothing usable. */
export const MIN_KNOWLEDGE_WORDS = 25

/** A research finding, with where its quote was checked when the agent knows. */
export type BlogFinding = Finding & { verifiedOn?: 'page' | 'snippet' }

/**
 * A search result's title as a reference can show it: without the "..."
 * search engines add where they cut it, on one line.
 */
export function cleanSourceTitle(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .replace(/\s*(?:\.{3}|…)\s*$/, '')
    .trim()
}

/**
 * A source's title: the search result's, unless the search engine cut it
 * ("...") and the page's own title finishes it. A page title that does not
 * start like the search title (a press release's dateline, a site name) is
 * not used.
 */
export function pickSourceTitle(searchTitle: string, pageTitle?: string): string {
  const search = cleanSourceTitle(searchTitle)
  const page = cleanSourceTitle(pageTitle ?? '')
  if (!search) return page
  if (!page) return search
  const cut = /(?:\.{3}|…)\s*$/.test(searchTitle.trim())
  const words = (text: string) => text.toLowerCase().split(/\W+/).filter(Boolean)
  const head = words(search).slice(0, 4).join(' ')
  return cut && head && words(page).join(' ').startsWith(head) ? page : search
}

/**
 * Sources that are one page (found twice, or several quotes from it) made
 * one: its quotes in order, the best rating, and "read on the page" when
 * any of its quotes was.
 */
export function mergeWebSources(sources: BlogSource[]): BlogSource[] {
  const byPage = new Map<string, BlogSource>()
  const order: string[] = []
  for (const source of sources) {
    const key = source.url ? normalizeUrlForCompare(source.url) : `#${order.length}`
    const kept = byPage.get(key)
    if (!kept) {
      byPage.set(key, { ...source, quotes: sourceQuotes(source) })
      order.push(key)
      continue
    }
    const quotes = kept.quotes ?? []
    for (const quote of sourceQuotes(source)) {
      if (!quotes.some(q => q.trim() === quote.trim())) quotes.push(quote)
    }
    const better = (a?: SourceRating, b?: SourceRating) =>
      (b?.score ?? -1) > (a?.score ?? -1) ? b : a
    byPage.set(key, {
      ...kept,
      quotes,
      rating: better(kept.rating, source.rating),
      ...(!kept.publisher && source.publisher && { publisher: source.publisher }),
      ...(!kept.publishedAt &&
        source.publishedAt && { publishedAt: source.publishedAt }),
      ...((kept.verifiedOn === 'page' || source.verifiedOn === 'page') && {
        verifiedOn: 'page' as const
      })
    })
  }
  return order.map(key => byPage.get(key)!)
}

/**
 * Research findings worth writing from: pages written to rank and pages about
 * another market dropped (screenFindings), each rated, one source per page
 * with all its quotes, the best first, at most MAX_WEB_SOURCES. A page the
 * agent read is titled as the page titles itself. Ids are given by
 * numberSources.
 */
export function webSourcesFrom(
  findings: BlogFinding[],
  options: {
    regionCode?: string
    regionName?: string
    ownHosts: string[]
    /** Titles of the pages the agent read, by URL. */
    pageTitles?: Record<string, string>
  }
): BlogSource[] {
  const { kept } = screenFindings(findings, {
    regionCode: options.regionCode,
    regionName: options.regionName
  })
  const rated = (kept as BlogFinding[])
    .map(finding => ({
      finding,
      rating: rateSource({
        url: finding.url,
        origin: 'web',
        ownHosts: options.ownHosts,
        regionCode: options.regionCode,
        publisher: finding.publisher,
        fromNewsSearch: finding.provider === 'serper_news'
      })
    }))
    .filter(({ rating }) => rating.tier !== 'low')
    .map(({ finding, rating }) => ({
      id: '',
      origin: 'web' as const,
      title:
        pickSourceTitle(finding.title, options.pageTitles?.[finding.url]) ||
        finding.url,
      url: finding.url,
      ...(finding.publisher && { publisher: finding.publisher }),
      quote: finding.snippet,
      ...(finding.verifiedOn && { verifiedOn: finding.verifiedOn }),
      ...(finding.publishedAt && { publishedAt: finding.publishedAt }),
      rating,
      cited: false
    }))
  return mergeWebSources(rated)
    .sort((a, b) => (b.rating?.score ?? 0) - (a.rating?.score ?? 0))
    .slice(0, MAX_WEB_SOURCES)
}

/** Whether any of a source's quotes states a figure. */
const statesFigure = (source: BlogSource) =>
  sourceQuotes(source).some(quote => extractNumbers(quote).length > 0)

const normalizeForSearch = (text: string) =>
  text.toLowerCase().replace(/\s+/g, ' ').trim()

/** Pages fetched at most, to confirm figures seen only in search snippets. */
export const MAX_FIGURE_CONFIRMATIONS = 6

/**
 * Web sources whose figures were seen only in a search snippet, checked on
 * the page itself: a source is marked read on the page when every one of its
 * quotes is there. Pages that cannot be fetched stay as they were; nothing
 * is dropped. `fetchText` returns the page's text, or null.
 */
export async function confirmSnippetFigures(
  sources: BlogSource[],
  fetchText: (url: string) => Promise<string | null>,
  options: { max?: number } = {}
): Promise<BlogSource[]> {
  const toCheck = sources
    .filter(
      source =>
        source.origin === 'web' &&
        source.url &&
        source.verifiedOn === 'snippet' &&
        statesFigure(source)
    )
    .slice(0, options.max ?? MAX_FIGURE_CONFIRMATIONS)
  const confirmed = new Set<BlogSource>()
  await Promise.all(
    toCheck.map(async source => {
      const text = await fetchText(source.url!).catch(() => null)
      if (!text) return
      const page = normalizeForSearch(text)
      if (sourceQuotes(source).every(quote => page.includes(normalizeForSearch(quote)))) {
        confirmed.add(source)
      }
    })
  )
  return sources.map(source =>
    confirmed.has(source) ? { ...source, verifiedOn: 'page' as const } : source
  )
}

/** The idea's evidence that names a page, as sources. */
export function ideaSourcesFrom(
  idea: Pick<Idea, 'supportingEvidence'> | null
): BlogSource[] {
  return (idea?.supportingEvidence ?? []).flatMap(evidence => {
    const url = evidence.sourceUrl?.trim()
    if (!url) return []
    return [
      {
        id: '',
        origin: 'idea' as const,
        title: evidence.sourceTitle?.trim() || url,
        url,
        ...(evidence.publisher && { publisher: evidence.publisher }),
        quote: (evidence.quote || evidence.claim).trim(),
        ...(evidence.publishedAt && { publishedAt: evidence.publishedAt }),
        ...(evidence.credibility && { rating: evidence.credibility }),
        cited: false
      }
    ]
  })
}

const MARKDOWN_LINK = /\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))*\)/g
/** Four or more single letters spaced apart: a heading styled "O n e S e t". */
const SPACED_LETTERS = /(?<![\p{L}\p{N}])(?:\p{L}[ \t]){3,}\p{L}(?![\p{L}\p{N}])/gu

/** A line that is mostly links: a menu, a footer, a list of pages. */
function isLinkLine(line: string): boolean {
  const links = [...line.matchAll(MARKDOWN_LINK)]
  if (links.length === 0) return false
  const labels = links.reduce((sum, match) => sum + match[1]!.trim().length, 0)
  const rest = line
    .replace(MARKDOWN_LINK, '')
    .replace(/[*•|·>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!rest) return true
  return links.length >= 3 && labels / (labels + rest.length) >= 0.3
}

/**
 * A knowledge passage as the writer should read it: without the page's
 * menus, footers, images and link lists, letter-spaced display headings or
 * heading marks; links kept as their words only.
 */
export function cleanKnowledgePassage(text: string): string {
  return text
    .split(/\n/)
    .map(line => line.replace(/!\[[^\]]*\]\([^)]*\)/g, ''))
    .filter(line => !isLinkLine(line))
    .map(line =>
      line
        .replace(MARKDOWN_LINK, (_, label: string) => label)
        .replace(SPACED_LETTERS, '')
        .replace(/^\s*(?:#{1,6}|[*•-])\s+/, '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s,.;:]+(?=\S)/, '')
        .trim()
    )
    .filter(line => /[\p{L}\p{N}]/u.test(line))
    .join('\n')
}

/**
 * Knowledge-base passages as sources, one per document (its passages as the
 * source's quotes), cleaned, and titled by their document. A passage that is
 * only navigation is left out. `ownPage` says whether the document is the
 * company's own page or a third party's page about it (a directory listing
 * is the vendor's own claim, not independent proof).
 */
export function knowledgeSourcesFrom(
  passages: KnowledgePassage[],
  docs: Array<{ id: string; title: string; sourceUrl: string | null }>,
  ownHosts: string[] = []
): BlogSource[] {
  const own = new Set(ownHosts.map(host => host.toLowerCase().replace(/^www\./, '')))
  const isOwn = (url: string) => {
    try {
      return own.has(new URL(url).hostname.toLowerCase().replace(/^www\./, ''))
    } catch {
      return false
    }
  }
  const byDoc = new Map<string, BlogSource>()
  for (const passage of passages) {
    const quote = cleanKnowledgePassage(passage.content)
    if (countWords(quote) < MIN_KNOWLEDGE_WORDS) continue
    const kept = byDoc.get(passage.documentId)
    if (kept) {
      kept.quotes = [...(kept.quotes ?? []), quote]
      continue
    }
    if (byDoc.size >= MAX_KNOWLEDGE_SOURCES) continue
    const doc = docs.find(d => d.id === passage.documentId)
    const url = doc?.sourceUrl ?? null
    byDoc.set(passage.documentId, {
      id: '',
      origin: 'knowledge',
      title: doc?.title || 'Knowledge base',
      url,
      quote,
      quotes: [quote],
      ...(url && { ownPage: isOwn(url) }),
      cited: false
    })
  }
  return [...byDoc.values()]
}

/**
 * The pool, numbered: web then idea sources S1, S2…, knowledge K1, K2…. A
 * page found twice (by research and in the idea) is kept once.
 */
export function numberSources(
  web: BlogSource[],
  idea: BlogSource[],
  knowledge: BlogSource[]
): BlogSource[] {
  // A page found by research and named in the idea is one source with both quotes.
  const external = mergeWebSources([...web, ...idea])
  return [
    ...external.map((source, i) => ({
      ...source,
      id: `S${i + 1}`,
      cited: false
    })),
    ...knowledge.map((source, i) => ({
      ...source,
      id: `K${i + 1}`,
      cited: false
    }))
  ]
}

/** Everything a figure in the blog may come from: the author's details and the pool. */
export function figureSourcesText(
  ctx: GenerationContext,
  sources: BlogSource[],
  /** The author's own words in the brief (instructions, reader note): theirs to state. */
  authorTexts: string[] = []
): string {
  return [
    accountTextOf(ctx),
    ...authorTexts.filter(Boolean),
    ...sources.map(
      source => `${source.title}\n${sourceQuotes(source).join('\n')}`
    )
  ].join('\n')
}

/** Other people's words the blog must not lift: web and idea quotes. */
export function thirdPartyTexts(sources: BlogSource[]): string[] {
  return sources
    .filter(source => source.origin !== 'knowledge')
    .flatMap(sourceQuotes)
    .filter(Boolean)
}
