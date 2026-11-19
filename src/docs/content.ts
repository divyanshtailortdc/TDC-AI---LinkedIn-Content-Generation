import 'server-only'

import type { MDXContent } from 'mdx/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildDocsSearchIndex, docContentFile } from './build-index'
import { findDocPage, type DocPage } from './nav'
import type { DocsSearchIndexPage } from './search'
import { parseDoc, type ParsedDoc } from './sections'

/**
 * The help pages' files. Each page's compiled MDX is bundled (Turbopack's
 * import.meta.glob) and loaded when it is opened. Its source text, for the
 * "On this page" list and search, is read from disk: a `?raw` import of an
 * .mdx file still goes through the MDX loader. next.config.ts traces
 * src/docs/content into the docs routes so the files are there when deployed.
 */
const compiled = import.meta.glob('./content/**/*.mdx') as Record<
  string,
  () => Promise<{ default: MDXContent }>
>

const CONTENT_DIR = join(process.cwd(), 'src', 'docs', 'content')
// Read once in production; in development every request sees edits.
const keepSources = process.env.NODE_ENV === 'production'
const cache = new Map<string, string | undefined>()

/** A content file's text. Only ever called with files named by the nav. */
function sourceOf(file: string): string | undefined {
  if (keepSources && cache.has(file)) return cache.get(file)
  let source: string | undefined
  try {
    source = readFileSync(join(CONTENT_DIR, file), 'utf8')
  } catch {
    source = undefined
  }
  if (keepSources) cache.set(file, source)
  return source
}

export type LoadedDoc = {
  page: DocPage
  Content: MDXContent
  parsed: ParsedDoc
}

/** A page by its slug, or null when there is none (or its file is missing). */
export async function loadDoc(slug: string): Promise<LoadedDoc | null> {
  // Only pages in the nav: the slug comes from the address.
  const page = findDocPage(slug)
  if (!page) return null
  const file = docContentFile(page.slug)
  const load = compiled[`./content/${file}`]
  const source = sourceOf(file)
  if (!load || source === undefined) return null
  const { default: Content } = await load()
  return { page, Content, parsed: parseDoc(source) }
}

let searchIndex: DocsSearchIndexPage[] | null = null

/** Every page as text, split at its headings, for docs search. */
export function docsSearchIndex(): DocsSearchIndexPage[] {
  if (!keepSources) return buildDocsSearchIndex(sourceOf)
  searchIndex ??= buildDocsSearchIndex(sourceOf)
  return searchIndex
}
