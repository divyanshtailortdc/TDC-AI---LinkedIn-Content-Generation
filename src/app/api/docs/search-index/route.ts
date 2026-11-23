import { docsSearchIndex } from '@/docs/content'

/**
 * The help pages as text, split at their headings, for the docs search
 * dialog to search by words in the browser. Public, like the pages. Built
 * once per server from the bundled pages; browsers keep it a few minutes.
 */
export function GET() {
  return Response.json(
    { pages: docsSearchIndex() },
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  )
}
