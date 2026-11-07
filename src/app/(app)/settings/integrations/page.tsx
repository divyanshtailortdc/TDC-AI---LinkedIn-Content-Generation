import { publishingConfig } from '@/lib/publishing/config'
import { getCurrentConnection } from '@/lib/publishing/current-connection'
import { CALLBACK_RESULTS, type CallbackResult } from '@/lib/publishing/provider'
import { PUBLISHING_PLATFORM } from '@/lib/publishing/platform'
import { RESULT_PARAM } from '@/lib/publishing/routes'
import { requireUser } from '@/lib/session'
import type { Metadata } from 'next'
import { ConnectionSection } from './connection-section'

export const metadata: Metadata = {
  title: 'Integrations · TDC Content Engine'
}

export const dynamic = 'force-dynamic'

const isCallbackResult = (value: unknown): value is CallbackResult =>
  typeof value === 'string' && Object.hasOwn(CALLBACK_RESULTS, value)

export default async function IntegrationsSettingsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireUser()
  const configured = publishingConfig() !== null
  const [connection, { [RESULT_PARAM]: outcome }] = await Promise.all([
    // One read with the layout's when both render; none when not set up.
    configured ? getCurrentConnection(user.id) : null,
    searchParams
  ])
  // The outcome of the OAuth callback, as a message; nothing from the platform.
  const result = isCallbackResult(outcome) ? outcome : null
  return (
    <ConnectionSection
      platform={PUBLISHING_PLATFORM}
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
