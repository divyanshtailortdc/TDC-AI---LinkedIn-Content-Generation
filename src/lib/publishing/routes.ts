import 'server-only'

import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import { NextResponse } from 'next/server'
import { env } from '~/env'
import type { CallbackResult } from './provider'
import { PUBLISHING_PLATFORM } from './platform'

/** Holds the signed OAuth state between /connect and /callback only. */
export const STATE_COOKIE = 'tdc_publish_state'
export const STATE_COOKIE_PATH = '/api/integrations'

/** Where the platform sends the browser back after the user allows publishing. */
export const CALLBACK_PATH = `/api/integrations/${PUBLISHING_PLATFORM.id}/callback`

/** The query parameter Settings → Integrations reads the outcome from. */
export const RESULT_PARAM = 'connection'

/**
 * Back to Settings → Integrations with the outcome, which the page turns into a
 * message. On `base`'s origin: the callback's own, where the session is.
 */
export function settingsRedirect(result: CallbackResult, base?: string) {
  const url = new URL(
    INTEGRATIONS_SETTINGS_PATH,
    base ?? env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL
  )
  url.searchParams.set(RESULT_PARAM, result)
  const response = NextResponse.redirect(url, 303)
  // Whatever happened, the state is single-use.
  response.cookies.delete({ name: STATE_COOKIE, path: STATE_COOKIE_PATH })
  return response
}
