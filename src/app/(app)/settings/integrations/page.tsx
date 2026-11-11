import {
  callbackMessage,
  isCallbackResult
} from '@/lib/publishing/callback-results'
import { publishConfigs } from '@/lib/publishing/config'
import { getCurrentConnections } from '@/lib/publishing/current-connection'
import { PUBLISHING_PLATFORM_IDS } from '@/lib/publishing/platform'
import { providerFor } from '@/lib/publishing/provider'
import { PLATFORM_PARAM, RESULT_PARAM } from '@/lib/publishing/routes'
import { requireUser } from '@/lib/session'
import type { Metadata } from 'next'
import { ConnectionSection } from './connection-section'

export const metadata: Metadata = {
  title: 'Integrations · TDC Content Engine'
}

export const dynamic = 'force-dynamic'

export default async function IntegrationsSettingsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireUser()
  const configs = publishConfigs()
  const anyConfigured = Object.keys(configs).length > 0
  const [connections, query] = await Promise.all([
    // One read with the layout's when both render; none when not set up.
    anyConfigured ? getCurrentConnections(user.id) : [],
    searchParams
  ])
  // The outcome of an OAuth callback, as a message on its platform's card
  // (LinkedIn's when none is named); nothing from the provider.
  const outcome = query[RESULT_PARAM]
  const result = isCallbackResult(outcome) ? outcome : null
  const resultPlatform = query[PLATFORM_PARAM] ?? 'linkedin'
  return (
    <div className="space-y-6">
      {PUBLISHING_PLATFORM_IDS.map(id => {
        const provider = providerFor(id)
        const config = configs[id]
        return (
          <ConnectionSection
            key={id}
            platform={provider.platform}
            connectWith={config ? provider.connectWith(config) : 'oauth'}
            via={provider.via ?? null}
            configured={Boolean(config)}
            connection={connections.find(c => c.platform === id) ?? null}
            notice={
              result && resultPlatform === id
                ? {
                    variant: result === 'connected' ? 'success' : 'error',
                    message: callbackMessage(result, provider.platform.name)
                  }
                : null
            }
          />
        )
      })}
    </div>
  )
}
