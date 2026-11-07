import 'server-only'

import { LINKEDIN_SETTINGS_PATH } from '@/lib/settings-path'
import { NextResponse } from 'next/server'
import { env } from '~/env'
import type { CallbackResult } from './oauth'

/** Holds the signed OAuth state between /connect and /callback only. */
export const STATE_COOKIE = 'tdc_linkedin_publish_state'
export const STATE_COOKIE_PATH = '/api/linkedin'

/**
 * Back to Settings → LinkedIn with the outcome, which the page turns into a
 * message. On `base`'s origin: the callback's own, where the session is.
 */
export function settingsRedirect(result: CallbackResult, base?: string) {
  const url = new URL(
    LINKEDIN_SETTINGS_PATH,
    base ?? env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL
  )
  url.searchParams.set('linkedin', result)
  const response = NextResponse.redirect(url, 303)
  // Whatever happened, the state is single-use.
  response.cookies.delete({ name: STATE_COOKIE, path: STATE_COOKIE_PATH })
  return response
}
