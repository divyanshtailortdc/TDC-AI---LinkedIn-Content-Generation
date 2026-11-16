import { db } from '@/db'
import { getIdentity } from '@/lib/identity'
import { getBufferSummary } from '@/lib/publishing/buffer/connection'
import {
  bufferCallbackMessage,
  isCallbackResult
} from '@/lib/publishing/callback-results'
import {
  anyBufferConfig,
  bufferConnectConfig,
  enabledBufferPlatforms,
  publishConfigs
} from '@/lib/publishing/config'
import { getCurrentConnections } from '@/lib/publishing/current-connection'
import {
  isBufferPlatform,
  PUBLISHING_PLATFORM_IDS
} from '@/lib/publishing/platform'
import {
  BUFFER_FLOW,
  PLATFORM_PARAM,
  RESULT_PARAM
} from '@/lib/publishing/routes'
import { getSessionUser } from '@/lib/session'
import type { Metadata } from 'next'
import { BufferSection } from './buffer-section'

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
  const [identity, user] = await Promise.all([getIdentity(), getSessionUser()])
  const configs = publishConfigs()
  const anyConfigured = Object.keys(configs).length > 0
  // Buffer is connected once per user, for every identity.
  const bufferOn = anyBufferConfig() !== null
  const [connections, buffer, query] = await Promise.all([
    // One read with the layout's when both render; none when not set up.
    anyConfigured && identity ? getCurrentConnections(identity.id) : [],
    bufferOn && user ? getBufferSummary(db, user.id) : null,
    searchParams
  ])
  const bufferConnectable = bufferConnectConfig() !== null
  // The identity's networks published through Buffer: all on the Buffer card.
  const bufferNetworks = connections.filter(c => isBufferPlatform(c.platform))
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
      {/* LinkedIn, X, Threads, Facebook and Instagram: one Buffer card for them all. */}
      {bufferOn && (
        <BufferSection
          configured={bufferConnectable}
          buffer={buffer}
          networks={bufferNetworks}
          enabledPlatforms={enabledBufferPlatforms()}
          hasIdentity={Boolean(identity)}
          notice={
            result && resultPlatform === BUFFER_FLOW
              ? {
                  variant: result === 'connected' ? 'success' : 'error',
                  message: bufferCallbackMessage(result)
                }
              : null
          }
        />
      )}
    </div>
  )
}
