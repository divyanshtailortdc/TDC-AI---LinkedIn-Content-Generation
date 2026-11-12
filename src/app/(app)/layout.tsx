import { PublishingStatusProvider } from '@/components/publishing-header-button'
import { MobileNavProvider } from '@/components/mobile-nav'
import { RefreshOnBack } from '@/components/refresh-on-back'
import { Sidebar } from '@/components/sidebar'
import { ToastContainer } from '@/components/toast-notification'
import { db } from '@/db'
import { ideasTable } from '@/db/schema'
import { getIdentity, listIdentities } from '@/lib/identity'
import { publishConfigs } from '@/lib/publishing/config'
import { getCurrentConnections } from '@/lib/publishing/current-connection'
import { PUBLISHING_PLATFORM_IDS } from '@/lib/publishing/platform'
import { providerFor } from '@/lib/publishing/provider'
import { requireUser } from '@/lib/session'
import { SIDEBAR_COLLAPSED_COOKIE } from '@/lib/sidebar-pref'
import { and, count, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export default async function AppLayout({
  children
}: {
  children: React.ReactNode
}) {
  // Everything under this layout is signed-in only. The proxy already sent
  // visitors without a session cookie to /login; this is the real check.
  const user = await requireUser()
  const configs = publishConfigs()
  const configuredPlatforms = PUBLISHING_PLATFORM_IDS.flatMap(id => {
    const config = configs[id]
    return config ? [{ id, config }] : []
  })
  // The identity being worked on; the user may own several.
  const [identity, identities] = await Promise.all([
    getIdentity(),
    listIdentities()
  ])
  const [[{ pending = 0 } = {}], cookieStore, connections] = await Promise.all([
    // The badge on Ideas: what the active identity still has to approve.
    identity
      ? db
          .select({ pending: count() })
          .from(ideasTable)
          .where(
            and(
              eq(ideasTable.accountId, identity.id),
              eq(ideasTable.status, 'proposed')
            )
          )
      : [{ pending: 0 }],
    cookies(),
    // For a post's Publish controls (usePlatformPublishing): the active
    // identity's connections, never a token (and shared with Settings →
    // Integrations). Skipped when publishing is not set up, so the app does
    // not depend on its tables.
    configuredPlatforms.length > 0 && identity
      ? getCurrentConnections(identity.id)
      : []
  ])
  const sidebarCollapsed =
    cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === '1'

  return (
    <MobileNavProvider>
      <PublishingStatusProvider
        value={{
          platforms: configuredPlatforms.map(({ id, config }) => {
            const provider = providerFor(id)
            const connection = connections.find(c => c.platform === id)
            return {
              platform: provider.platform,
              connectWith: provider.connectWith(config),
              status: connection?.status ?? null,
              name: connection?.name ?? null
            }
          })
        }}
      >
        <div className="flex h-dvh">
          <Sidebar
            hasIdentity={Boolean(identity)}
            identities={identities.map(({ id, name, handle, accountType }) => ({
              id,
              name,
              handle,
              accountType
            }))}
            activeIdentityId={identity?.id ?? null}
            ideasToReview={pending}
            initialCollapsed={sidebarCollapsed}
            user={{ name: user.name, email: user.email }}
          />
          <main className="bg-background relative flex min-w-0 flex-1 flex-col overflow-y-auto">
            <RefreshOnBack>{children}</RefreshOnBack>
          </main>
          <ToastContainer />
        </div>
      </PublishingStatusProvider>
    </MobileNavProvider>
  )
}
