import { MobileNavProvider } from '@/components/mobile-nav'
import { GettingStartedTour } from '@/components/onboarding/getting-started-tour'
import { OnboardingProvider } from '@/components/onboarding/onboarding-provider'
import { PublishingStatusProvider } from '@/components/publishing-header-button'
import { RefreshOnBack } from '@/components/refresh-on-back'
import { Sidebar } from '@/components/sidebar'
import { ToastContainer } from '@/components/toast-notification'
import { db } from '@/db'
import { ideasTable } from '@/db/schema'
import { HelpButton } from '@/docs/components/help-button'
import { getIdentity, listIdentities } from '@/lib/identity'
import { loadOnboardingView } from '@/lib/onboarding/view'
import { publishConfigs } from '@/lib/publishing/config'
import { getCurrentConnections } from '@/lib/publishing/current-connection'
import { PUBLISHING_PLATFORM_IDS } from '@/lib/publishing/platform'
import { providerFor } from '@/lib/publishing/provider'
import { requireUser } from '@/lib/session'
import { SIDEBAR_COLLAPSED_COOKIE } from '@/lib/sidebar-pref'
import { and, count, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { Fragment } from 'react'

export const dynamic = 'force-dynamic'
/**
 * Every page's server actions, and the runs and drafts they start with
 * `after()`, get Vercel's most (FUNCTION_MAX_DURATION_S in
 * src/lib/function-limit.ts); a literal, as segment config must be.
 */
export const maxDuration = 300

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
  const [[{ pending = 0 } = {}], cookieStore, connections, onboarding] =
    await Promise.all([
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
        : [],
      // The getting-started progress: the first-run tour and the publish
      // review read it.
      loadOnboardingView(user.id, identity)
    ])
  const sidebarCollapsed =
    cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === '1'

  return (
    <MobileNavProvider>
      <OnboardingProvider key={identity?.id ?? 'none'} initial={onboarding}>
        <PublishingStatusProvider
          value={{
            platforms: configuredPlatforms.map(({ id }) => {
              const provider = providerFor(id)
              const connection = connections.find(c => c.platform === id)
              return {
                platform: provider.platform,
                status: connection?.status ?? null,
                name: connection?.name ?? null
              }
            })
          }}
        >
          <div className="flex h-dvh">
            <Sidebar
              hasIdentity={Boolean(identity)}
              identities={identities.map(
                ({ id, name, handle, accountType }) => ({
                  id,
                  name,
                  handle,
                  accountType
                })
              )}
              activeIdentityId={identity?.id ?? null}
              ideasToReview={pending}
              initialCollapsed={sidebarCollapsed}
              user={{ name: user.name, email: user.email }}
            />
            <main className="bg-background relative flex min-w-0 flex-1 flex-col overflow-y-auto">
              <RefreshOnBack>
                {/* Switching identity reloads the page with router.refresh(),
                  which keeps client state: a form would still hold the
                  previous identity's values, and its Save would write them
                  into the new one. Keyed by identity, the page starts afresh
                  from the new identity's data. The key sits inside
                  RefreshOnBack so a Back-after-change reload it started
                  survives the switch. */}
                <Fragment key={identity?.id ?? 'none'}>{children}</Fragment>
              </RefreshOnBack>
            </main>
            <ToastContainer />
            <HelpButton />
            <GettingStartedTour userId={user.id} />
          </div>
        </PublishingStatusProvider>
      </OnboardingProvider>
    </MobileNavProvider>
  )
}
