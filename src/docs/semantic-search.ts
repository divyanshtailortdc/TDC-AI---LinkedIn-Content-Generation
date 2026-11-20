import 'server-only'

import { getEmbeddingModel } from '@/lib/ai'
import { embedValues } from '@/lib/ai/embed'
import { cosineSimilarity } from 'ai'
import { docsSearchIndex } from './content'
import {
  decodeVector,
  sectionEmbeddingHash,
  sectionEmbeddingInput,
  storedEmbeddingsOf
} from './embedding-input'
import {
  bestSnippet,
  categoryOf,
  queryTerms,
  type DocSearchResult,
  type DocSnippet
} from './search'

/**
 * Docs search by meaning, for questions the words of a page may not share
 * ("why didn't my post go out?" finds the page on publishing failures). The
 * question is embedded and compared with each section of each page, as
 * embedded by `pnpm docs:index` (src/docs/scripts/build-search-index.ts).
 * Callers charge it with withAiSpend (source 'help').
 */

/** Below this, a section is unrelated rather than a weak match. */
const MIN_SIMILARITY = 0.3
const EMBED_TIMEOUT_MS = 15_000

// Bundled with the server, like the pages; {} until the index is first built.
// The whole module, unwrapped by storedEmbeddingsOf: with `import: 'default'`
// Turbopack handed over undefined, and search by meaning found nothing.
const files = import.meta.glob('./search-embeddings.json', {
  eager: true
}) as Record<string, unknown>

type IndexedSection = {
  slug: string
  title: string
  category: string
  sectionId: string
  heading: string
  text: string
  vector: number[]
}

let indexed: { modelId: string; sections: IndexedSection[] } | null = null

/**
 * The sections that have a stored vector for their current text. One edited
 * since the index was built has none, and is found by words alone until the
 * index is built again.
 */
function indexedSections(modelId: string): IndexedSection[] {
  if (indexed?.modelId === modelId) return indexed.sections
  const stored = storedEmbeddingsOf(files['./search-embeddings.json'])
  const byHash = new Map(
    stored && stored.model === modelId
      ? stored.sections.map(section => [section.hash, section.vector])
      : []
  )
  const sections = docsSearchIndex().flatMap(page =>
    page.sections.flatMap(section => {
      const hash = sectionEmbeddingHash(
        modelId,
        sectionEmbeddingInput(page, section)
      )
      const vector = byHash.get(hash)
      if (!vector || !section.text) return []
      return [
        {
          slug: page.slug,
          title: page.title,
          category: categoryOf(page),
          sectionId: section.id,
          heading: section.heading,
          text: section.text,
          vector: decodeVector(vector)
        }
      ]
    })
  )
  indexed = { modelId, sections }
  return sections
}

export class DocsSearchUnavailableError extends Error {
  constructor() {
    super('Search by meaning is not set up.')
    this.name = 'DocsSearchUnavailableError'
  }
}

/** The pages that best answer `query`, each with its closest passages. */
export async function searchDocsByMeaning(
  query: string,
  { limit = 5, maxSnippets = 2 } = {}
): Promise<DocSearchResult[]> {
  const handle = getEmbeddingModel()
  if (!handle) throw new DocsSearchUnavailableError()
  const sections = indexedSections(handle.modelId)
  if (sections.length === 0) return []

  const [queryVector] = await embedValues(handle, [query], {
    abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS)
  })
  if (!queryVector) return []

  const ranked = sections
    .map(section => ({
      section,
      similarity: cosineSimilarity(queryVector, section.vector)
    }))
    .filter(({ similarity }) => similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)

  const terms = queryTerms(query)
  const pages = new Map<string, DocSearchResult>()
  for (const { section } of ranked) {
    let page = pages.get(section.slug)
    if (!page) {
      if (pages.size >= limit) continue
      page = {
        slug: section.slug,
        title: section.title,
        category: section.category,
        snippets: []
      }
      pages.set(section.slug, page)
    }
    if (page.snippets.length < maxSnippets) {
      const snippet: DocSnippet = {
        sectionId: section.sectionId,
        heading: section.heading,
        text: bestSnippet(section.text, terms)
      }
      page.snippets.push(snippet)
    }
  }
  return [...pages.values()]
}
