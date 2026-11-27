import { NoIdentity } from '@/components/no-identity'
import { loadChannels } from '@/lib/channels'
import { getIdentity } from '@/lib/identity'
import { PLATFORMS, type PlatformId } from '@/lib/platforms'
import { publishConfigs } from '@/lib/publishing/config'
import { getCurrentConnections } from '@/lib/publishing/current-connection'
import { uploadPlatforms } from '~/lib/media-upload/rules'
import { canStoreUploads } from '~/lib/media/image-store'
import {
  CreateFromMediaClient,
  type PlatformChoice
} from './create-from-media-client'

export const dynamic = 'force-dynamic'
// Publish now publishes every platform's post in the action's request.
export const maxDuration = 300

export default async function CreateFromMediaPage() {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Create from media" />

  const configured = Object.keys(publishConfigs()) as PlatformId[]
  const [channels, connections] = await Promise.all([
    loadChannels(identity.id),
    configured.length > 0 ? getCurrentConnections(identity.id) : []
  ])

  // Every platform media can go to, in the registry's order: whether the
  // identity posts there, and whether it can be published to from here.
  const platforms: PlatformChoice[] = [
    ...new Set([...uploadPlatforms('video'), ...uploadPlatforms('image')])
  ].map(id => {
    const connection = connections.find(c => c.platform === id)
    return {
      id,
      label: PLATFORMS[id].name,
      postsHere: channels.platforms.includes(id),
      publishing: configured.includes(id),
      connected: Boolean(
        connection && connection.status === 'connected' && connection.canPublish
      ),
      accountName: connection?.name ?? null
    }
  })

  return (
    <CreateFromMediaClient
      platforms={platforms}
      storageReady={canStoreUploads()}
      identityName={identity.name}
    />
  )
}
