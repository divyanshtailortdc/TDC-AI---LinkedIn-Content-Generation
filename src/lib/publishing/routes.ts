import 'server-only'

import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import { NextResponse } from 'next/server'
import { env } from '~/env'
import type { CallbackResult } from './callback-results'
import { RETURN_COOKIE, withConnectResult } from './return-path'

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

/**
 * The Buffer account connection's flow: its routes are
 * /api/integrations/buffer/{connect,callback}, its OAuth state is signed for
 * it, and its outcome is shown on the Buffer card.
 */
export const BUFFER_FLOW = 'buffer'

/** The query parameters Settings → Integrations reads the outcome from. */
export { PLATFORM_PARAM, RESULT_PARAM } from './return-path'

/**
 * Back to Settings → Integrations with the outcome for `platform`, which the
 * page turns into a message on that platform's card; or to `path`, the page
 * the flow was started from (src/lib/publishing/return-path.ts), which reads
 * the same parameters. On `base`'s origin: the callback's own, where the
 * session is.
 */
export function settingsRedirect(
  result: CallbackResult,
  platform: string,
  base?: string,
  path: string = INTEGRATIONS_SETTINGS_PATH
) {
  const url = new URL(
    withConnectResult(path, result, platform),
    base || env.BETTER_AUTH_URL || env.NEXT_PUBLIC_APP_URL
  )
  const response = NextResponse.redirect(url, 303)
  // Whatever happened, the state and the way back are single-use.
  response.cookies.delete({ name: STATE_COOKIE, path: STATE_COOKIE_PATH })
  response.cookies.delete({ name: RETURN_COOKIE, path: STATE_COOKIE_PATH })
  return response
}
