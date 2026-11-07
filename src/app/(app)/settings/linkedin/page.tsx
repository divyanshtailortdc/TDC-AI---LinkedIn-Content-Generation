import { linkedInPublishConfig } from '@/lib/linkedin/config'
import { getCurrentConnection } from '@/lib/linkedin/current-connection'
import { CALLBACK_RESULTS, type CallbackResult } from '@/lib/linkedin/oauth'
import { requireUser } from '@/lib/session'
import type { Metadata } from 'next'
import { LinkedInSection } from './linkedin-section'

export const metadata: Metadata = {
  title: 'LinkedIn · TDC LinkedIn Content Engine'
}

export const dynamic = 'force-dynamic'

const isCallbackResult = (value: unknown): value is CallbackResult =>
  typeof value === 'string' && Object.hasOwn(CALLBACK_RESULTS, value)

export default async function LinkedInSettingsPage({
  searchParams
}: {
  searchParams: Promise<{ linkedin?: string | string[] }>
}) {
  const user = await requireUser()
  const configured = linkedInPublishConfig() !== null
  const [connection, { linkedin }] = await Promise.all([
    // One read with the layout's when both render; none when not set up.
    configured ? getCurrentConnection(user.id) : null,
    searchParams
  ])
  // The outcome of the OAuth callback, as a message; nothing from LinkedIn.
  const result = isCallbackResult(linkedin) ? linkedin : null
  return (
    <LinkedInSection
      configured={configured}
      connection={connection}
      notice={
        result && {
          variant: result === 'connected' ? 'success' : 'error',
          message: CALLBACK_RESULTS[result]
        }
      }
    />
  )
}
