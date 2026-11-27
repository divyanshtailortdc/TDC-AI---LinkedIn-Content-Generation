import { sharedBlogPage } from '@/lib/blogs/shared-page'

/**
 * A blog's public link (src/lib/blogs/share.ts): its saved text as a page,
 * for anyone with the link, signed in or not (src/proxy.ts lets it through).
 * Never cached, so a link turned off stops working at once and the pictures'
 * signed links are fresh. Kept out of search results, and the page can run
 * no script, load nothing but pictures, and sits in no other site's frame.
 */

export const dynamic = 'force-dynamic'

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  // The link is the secret: never sent on to the pages the article links.
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
}

const NOT_SHARED = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link not available</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#fff;color:#1f2328;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center}h1{margin:0 0 .4em;font-size:1.4em}p{margin:0;color:#57606a}</style>
</head>
<body>
<main><h1>This link is not available</h1><p>Its owner may have stopped sharing it, or the blog was deleted.</p></main>
</body>
</html>
`

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const page = await sharedBlogPage(token)
  return page
    ? new Response(page, { headers: HEADERS })
    : new Response(NOT_SHARED, { status: 404, headers: HEADERS })
}
