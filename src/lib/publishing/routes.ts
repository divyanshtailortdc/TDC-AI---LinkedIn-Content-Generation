import 'server-only'

import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import { NextResponse } from 'next/server'
import { env } from '~/env'
import type { CallbackResult } from './callback-results'

/** Holds the signed OAuth state between /connect and /callback only. */
export const STATE_COOKIE = 'tdc_publish_state'
export const STATE_COOKIE_PATH = '/api/integrations'

/**
 * Where the provider sends the browser back after the user allows publishing
 * to `platform` (LinkedIn's consent screen, or Buffer's for X, Facebook and
 * Instagram).
 */
export const callbackPath = (platform: string) =>
  `/api/integrations/${platform}/callback`

/** The query parameters Settings → Integrations reads the outcome from. */
export const RESULT_PARAM = 'connection'
export const PLATFORM_PARAM = 'platform'

/**
 * Back to Settings → Integrations with the outcome for `platform`, which the
 * page turns into a message on that platform's card. On `base`'s origin: the
 * callback's own, where the session is.
 */
export function settingsRedirect(
  result: CallbackResult,
  platform: string,
  base?: string
) {
  const url = new URL(
    INTEGRATIONS_SETTINGS_PATH,
    base || env.BETTER_AUTH_URL || env.NEXT_PUBLIC_APP_URL
  )
  url.searchParams.set(RESULT_PARAM, result)
  url.searchParams.set(PLATFORM_PARAM, platform)
  const response = NextResponse.redirect(url, 303)
  // Whatever happened, the state is single-use.
  response.cookies.delete({ name: STATE_COOKIE, path: STATE_COOKIE_PATH })
  return response
}
