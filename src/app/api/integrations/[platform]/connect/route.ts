import { publishingConfig } from '@/lib/publishing/config'
import { canPublishTo } from '@/lib/publishing/platform'
import {
  buildAuthorizationUrl,
  createOAuthState,
  STATE_TTL_MS
} from '@/lib/publishing/provider'
import {
  settingsRedirect,
  STATE_COOKIE,
  STATE_COOKIE_PATH
} from '@/lib/publishing/routes'
import { loginPathFor } from '@/lib/safe-redirect'
import { getSessionUser } from '@/lib/session'
import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import { NextResponse } from 'next/server'

/**
 * Starts connecting a platform for publishing: sends the signed-in user to
 * the platform's consent screen with a fresh state, kept in a signed,
 * httpOnly cookie for the callback to check. Separate from sign-in: it never
 * touches the session or Better Auth's accounts. Only a platform with a
 * publishing provider (src/lib/publishing/platform.ts) has one.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string }> }
) {
  if (!canPublishTo((await params).platform)) {
    return new NextResponse('Not found', { status: 404 })
  }
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.redirect(
      new URL(loginPathFor(INTEGRATIONS_SETTINGS_PATH), request.url)
    )
  }

  const config = publishingConfig()
  if (!config) return settingsRedirect('not_configured')

  const { state, cookie } = createOAuthState(config.encryptionKey, user.id)
  const response = NextResponse.redirect(
    buildAuthorizationUrl(config, state),
    302
  )
  response.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: config.redirectUri.startsWith('https://'),
    // Lax: sent on the platform's top-level redirect back to the callback.
    sameSite: 'lax',
    path: STATE_COOKIE_PATH,
    maxAge: STATE_TTL_MS / 1000
  })
  return response
}
