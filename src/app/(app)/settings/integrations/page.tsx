import { getIdentity } from '@/lib/identity'
import {
  callbackMessage,
  isCallbackResult
} from '@/lib/publishing/callback-results'
import { publishConfigs } from '@/lib/publishing/config'
import { getCurrentConnections } from '@/lib/publishing/current-connection'
import { PUBLISHING_PLATFORM_IDS } from '@/lib/publishing/platform'
import { providerFor } from '@/lib/publishing/provider'
import { PLATFORM_PARAM, RESULT_PARAM } from '@/lib/publishing/routes'
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
  // Each identity connects its own accounts: these are the active one's.
  const identity = await getIdentity()
  const configs = publishConfigs()
  const anyConfigured = Object.keys(configs).length > 0
  const [connections, query] = await Promise.all([
    // One read with the layout's when both render; none when not set up.
    anyConfigured && identity ? getCurrentConnections(identity.id) : [],
    searchParams
  ])
  // The outcome of an OAuth callback, as a message on its platform's card
  // (LinkedIn's when none is named); nothing from the provider.
  const outcome = query[RESULT_PARAM]
  const result = isCallbackResult(outcome) ? outcome : null
  const resultPlatform = query[PLATFORM_PARAM] ?? 'linkedin'
  return (
    <div className="space-y-6">
      <p className="text-muted text-xs leading-relaxed">
        {identity ? (
          <>
            Accounts that <span className="text-foreground font-medium">{identity.name}</span>{' '}
            publishes to. Each of your identities connects its own; switch
            identity in the sidebar to manage another&apos;s.
          </>
        ) : (
          'Set up an identity first: each identity connects its own accounts.'
        )}
      </p>
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
