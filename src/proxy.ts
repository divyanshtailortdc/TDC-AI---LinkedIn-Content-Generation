import { getSessionCookie } from 'better-auth/cookies'
import { NextResponse, type NextRequest } from 'next/server'
import { loginPathFor } from './lib/safe-redirect'

/** Pages anyone can open: signing in. */
const PUBLIC_PATHS = ['/login']

/**
 * An early, cheap redirect for visitors with no session cookie, so they land
 * on /login instead of a page that fails part-way. It only checks that the
 * cookie is there, never that it is valid (no database here): a present
 * cookie proves nothing. The real check is requireUser() and the ownership
 * guards in every page, Server Action and API route.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  if (
    PUBLIC_PATHS.some(
      path => pathname === path || pathname.startsWith(`${path}/`)
    )
  ) {
    return NextResponse.next()
  }
  if (getSessionCookie(request)) return NextResponse.next()

  return NextResponse.redirect(
    new URL(loginPathFor(`${pathname}${search}`), request.url)
  )
}

export const config = {
  // Pages only. Not:
  // - api/: each route checks the session itself and answers 401. Left out
  //   so a proxy never sits in front of their request bodies or the abort
  //   signal that cancels a running analysis or image generation.
  // - _next/ and __nextjs: built assets, and dev-server tooling (hot reload,
  //   the error overlay), which must work on the sign-in pages too.
  // - favicon, robots.txt and image files.
  matcher: [
    '/((?!api/|_next/|__nextjs|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)'
  ]
}
