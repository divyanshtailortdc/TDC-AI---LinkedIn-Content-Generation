import { DOC_PAGES } from './nav'
import type { DocsSearchIndexPage } from './search'
import { parseDoc } from './sections'

/** A page's content file, relative to src/docs/content. */
export function docContentFile(slug: string) {
  return `${slug || 'introduction'}.mdx`
}

/**
 * Every page as text, split at its headings: what docs search reads, and
 * what src/docs/scripts/build-search-index.ts embeds. `readSource` gives a
 * content file's text (undefined when missing): read from disk in both the
 * app and the script.
 */
export function buildDocsSearchIndex(
  readSource: (file: string) => string | undefined
): DocsSearchIndexPage[] {
  return DOC_PAGES.flatMap(page => {
    const source = readSource(docContentFile(page.slug))
    if (source === undefined) return []
    return [
      {
        slug: page.slug,
        title: page.title,
        description: page.description,
        trail: page.trail,
        sections: parseDoc(source).sections.map(({ id, heading, text }) => ({
          id,
          heading: heading || page.title,
          text
        }))
      }
    ]
  })
}
