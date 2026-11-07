import { LinkedInStatusProvider } from '@/components/linkedin-header-button'
import { MobileNavProvider } from '@/components/mobile-nav'
import { RefreshOnBack } from '@/components/refresh-on-back'
import { Sidebar } from '@/components/sidebar'
import { ToastContainer } from '@/components/toast-notification'
import { db } from '@/db'
import { accountsTable, ideasTable } from '@/db/schema'
import { getIdentity } from '@/lib/identity'
import { linkedInPublishConfig } from '@/lib/linkedin/config'
import { getCurrentConnection } from '@/lib/linkedin/current-connection'
import { ownedByUser } from '@/lib/ownership'
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
  const publishingConfigured = linkedInPublishConfig() !== null
  const [identity, [{ pending = 0 } = {}], cookieStore, linkedIn] =
    await Promise.all([
      getIdentity(),
      // The badge on Ideas: what the identity still has to approve. Found
      // through the user's identity in the same query, so it does not wait
      // for getIdentity first.
      db
        .select({ pending: count() })
        .from(ideasTable)
        .innerJoin(accountsTable, eq(accountsTable.id, ideasTable.accountId))
        .where(and(ownedByUser(user.id), eq(ideasTable.status, 'proposed'))),
      cookies(),
      // For the header's LinkedIn button; never a token (and shared with
      // Settings → LinkedIn). Skipped when publishing is not set up, so the
      // app does not depend on its tables.
      publishingConfigured ? getCurrentConnection(user.id) : null
    ])
  const sidebarCollapsed =
    cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === '1'

  return (
    <MobileNavProvider>
      <LinkedInStatusProvider
        value={{
          configured: publishingConfigured,
          status: linkedIn?.status ?? null,
          name: linkedIn?.name ?? null
        }}
      >
        <div className="flex h-full min-h-screen">
          <Sidebar
            hasIdentity={Boolean(identity)}
            ideasToReview={pending}
            initialCollapsed={sidebarCollapsed}
            user={{ name: user.name, email: user.email }}
          />
          <main className="bg-background relative flex min-w-0 flex-1 flex-col overflow-y-auto">
            <RefreshOnBack>{children}</RefreshOnBack>
          </main>
          <ToastContainer />
        </div>
      </LinkedInStatusProvider>
    </MobileNavProvider>
  )
}
