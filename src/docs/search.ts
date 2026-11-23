/**
 * Docs search by words, run in the browser over the index from
 * /api/docs/search-index: page titles, headings and the text under them.
 * Questions ("how do I connect LinkedIn?") also go to /api/docs/search,
 * which ranks sections by meaning (src/docs/semantic-search.ts); both
 * return DocSearchResult, with snippets cut here.
 */

export type DocsSearchIndexPage = {
  slug: string
  title: string
  description?: string
  trail: string[]
  sections: Array<{ id: string; heading: string; text: string }>
}

export type DocSnippet = {
  /** The heading it is under, '' before the first. */
  sectionId: string
  heading: string
  text: string
}

export type DocSearchResult = {
  slug: string
  title: string
  /** Section > group, for the line under the title. */
  category: string
  snippets: DocSnippet[]
}

const STOPWORDS = new Set(
  (
    'a an and are as at be but by can could do does did for from get got has have how ' +
    'i if in into is it its me my of on or our should so that the their them then there ' +
    'these this to us was we what when where which who why will with would you your'
  ).split(' ')
)

/** A word without its common endings, so "scheduling" finds "schedule". */
export function stem(word: string): string {
  if (word.length <= 4) return word
  return word
    .replace(/(?:ations?|ings?|ments?|ness|ed|ly|es|s)$/, '')
    .replace(/e$/, '')
}

/** The words of a query worth matching, stemmed. */
export function queryTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .match(/[a-z0-9]+/g)
  if (!words) return []
  const kept = words.filter(word => !STOPWORDS.has(word))
  // A query of only stopwords ("how do I") still searches for them.
  return [...new Set((kept.length > 0 ? kept : words).map(stem))]
}

/**
 * A question or a long query: worth asking the meaning-based search, as
 * potential matches by words alone are likely to miss.
 */
export function isQuestion(query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q.length < 3) return false
  return (
    /^(how|what|why|where|when|which|who|can|could|is|are|does|do|should|tell me|explain)\b/.test(
      q
    ) ||
    q.endsWith('?') ||
    q.length > 30
  )
}

function containsTerm(haystack: string, term: string) {
  // Prefix of a word: "publish" finds "published" and "publishing".
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(
    haystack
  )
}

function countTerms(haystack: string, terms: string[]) {
  return terms.filter(term => containsTerm(haystack, term)).length
}

/**
 * The part of `text` that best shows the query: the line (paragraph, list
 * item) with the most of its words, cut to about `max` characters around the
 * first of them. The first line when none matches.
 */
export function bestSnippet(text: string, terms: string[], max = 180): string {
  const lines = text.split('\n').filter(line => line.trim().length > 0)
  if (lines.length === 0) return ''
  let best = lines[0]!
  let bestHits = terms.length > 0 ? countTerms(best.toLowerCase(), terms) : 0
  for (const line of lines.slice(1)) {
    const hits = countTerms(line.toLowerCase(), terms)
    if (hits > bestHits) {
      best = line
      bestHits = hits
    }
  }
  if (best.length <= max) return best
  const lower = best.toLowerCase()
  const firstHit = Math.min(
    ...terms.map(term => {
      const match = lower.match(
        new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
      )
      return match?.index ?? Infinity
    }),
    Infinity
  )
  const start =
    firstHit === Infinity ? 0 : Math.max(0, firstHit - Math.floor(max / 3))
  // Cut at word boundaries.
  const from = start === 0 ? 0 : best.indexOf(' ', start) + 1
  let snippet = best.slice(from, from + max)
  const lastSpace = snippet.lastIndexOf(' ')
  if (from + max < best.length && lastSpace > max * 0.6)
    snippet = snippet.slice(0, lastSpace)
  return `${from > 0 ? '…' : ''}${snippet.trim()}${from + snippet.length < best.length ? '…' : ''}`
}

export function categoryOf(page: Pick<DocsSearchIndexPage, 'trail'>) {
  return page.trail.join(' › ')
}

/**
 * Pages matching every word of the query (by prefix, after stemming), best
 * first: a match in the title counts most, then a heading, then the text.
 * Each comes with up to `maxSnippets` of its best matching sections.
 */
export function searchDocsIndex(
  index: DocsSearchIndexPage[],
  query: string,
  { limit = 8, maxSnippets = 2 } = {}
): DocSearchResult[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return []
  const phrase = query.trim().toLowerCase()

  const scored = index.flatMap(page => {
    const title = page.title.toLowerCase()
    const category = categoryOf(page).toLowerCase()
    const description = (page.description ?? '').toLowerCase()

    const sections = page.sections.map(section => {
      const heading = section.heading.toLowerCase()
      const text = section.text.toLowerCase()
      let score = 0
      let found = 0
      for (const term of terms) {
        const inHeading = containsTerm(heading, term)
        const inText = containsTerm(text, term)
        if (inHeading) score += 5
        if (inText) score += 1 + Math.min(3, text.split(term).length - 2)
        if (inHeading || inText) found++
      }
      if (phrase.length > 3 && text.includes(phrase)) score += 6
      return { section, score, found }
    })

    // Every word must appear somewhere on the page.
    const onPage = (term: string) =>
      containsTerm(title, term) ||
      containsTerm(category, term) ||
      containsTerm(description, term) ||
      sections.some(
        ({ section }) =>
          containsTerm(section.heading.toLowerCase(), term) ||
          containsTerm(section.text.toLowerCase(), term)
      )
    if (!terms.every(onPage)) return []

    const titleHits = countTerms(title, terms)
    const bestSections = sections
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.found - a.found || b.score - a.score)
    const score =
      titleHits * 12 +
      (title.includes(phrase) ? 10 : 0) +
      countTerms(category, terms) * 3 +
      countTerms(description, terms) * 2 +
      (bestSections[0]?.score ?? 0) +
      (bestSections[0]?.found === terms.length ? 4 : 0)

    const snippets = bestSections.slice(0, maxSnippets).map(({ section }) => ({
      sectionId: section.id,
      heading: section.heading,
      text: bestSnippet(section.text, terms)
    }))
    return [
      {
        score,
        result: {
          slug: page.slug,
          title: page.title,
          category: categoryOf(page),
          snippets
        }
      }
    ]
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ result }) => result)
}

/**
 * Where a search result's snippet opens: its page, scrolled to the snippet's
 * text and briefly highlighted (DocsScrollToText), else to its heading.
 */
export function snippetHash(snippet: DocSnippet) {
  const text = snippet.text.replace(/^…|…$/g, '').slice(0, 80)
  const params = new URLSearchParams({ text })
  if (snippet.sectionId) params.set('section', snippet.sectionId)
  return `#search&${params.toString()}`
}
