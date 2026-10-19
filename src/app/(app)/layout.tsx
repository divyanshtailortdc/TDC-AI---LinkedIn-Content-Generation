import { MobileNavProvider } from '@/components/mobile-nav'
import { Sidebar } from '@/components/sidebar'
import { ToastContainer } from '@/components/toast-notification'
import { db } from '@/db'
import { ideasTable } from '@/db/schema'
import { getIdentity } from '@/lib/identity'
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
  const [identity, cookieStore] = await Promise.all([getIdentity(), cookies()])
  const sidebarCollapsed =
    cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === '1'

  // The badge on Ideas: what the identity still has to approve.
  const [{ pending = 0 } = {}] = identity
    ? await db
        .select({ pending: count() })
        .from(ideasTable)
        .where(
          and(
            eq(ideasTable.accountId, identity.id),
            eq(ideasTable.status, 'proposed')
          )
        )
    : []

  return (
    <MobileNavProvider>
      <div className="flex h-full min-h-screen">
        <Sidebar
          hasIdentity={Boolean(identity)}
          ideasToReview={pending}
          initialCollapsed={sidebarCollapsed}
          user={{ name: user.name, email: user.email }}
        />
        <main className="bg-background relative flex min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
        <ToastContainer />
      </div>
    </MobileNavProvider>
  )
}
