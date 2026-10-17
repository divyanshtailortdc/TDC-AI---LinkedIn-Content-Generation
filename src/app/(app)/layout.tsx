import { MobileNavProvider } from '@/components/mobile-nav'
import { Sidebar } from '@/components/sidebar'
import { ToastContainer } from '@/components/toast-notification'
import { db } from '@/db'
import { accountsTable, ideasTable } from '@/db/schema'
import { and, count, eq } from 'drizzle-orm'
import { getActiveAccount } from '@/lib/active-account'
import { SIDEBAR_COLLAPSED_COOKIE } from '@/lib/sidebar-pref'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export default async function AppLayout({
  children
}: {
  children: React.ReactNode
}) {
  const [accounts, activeAccount, cookieStore] = await Promise.all([
    db
      .select({
        id: accountsTable.id,
        name: accountsTable.name,
        handle: accountsTable.handle,
        accountType: accountsTable.accountType
      })
      .from(accountsTable)
      .where(eq(accountsTable.isActive, true))
      .orderBy(accountsTable.createdAt),
    getActiveAccount(),
    cookies()
  ])
  const sidebarCollapsed = cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === '1'

  // The badge on Ideas: what the active identity still has to approve.
  const [{ pending = 0 } = {}] = activeAccount
    ? await db
        .select({ pending: count() })
        .from(ideasTable)
        .where(
          and(
            eq(ideasTable.accountId, activeAccount.id),
            eq(ideasTable.status, 'proposed')
          )
        )
    : []

  return (
    <MobileNavProvider>
      <div className="flex h-full min-h-screen">
        <Sidebar
          accounts={accounts}
          activeAccount={activeAccount}
          ideasToReview={pending}
          initialCollapsed={sidebarCollapsed}
        />
        <main className="flex-1 min-w-0 overflow-y-auto bg-background relative flex flex-col">
          {children}
        </main>
        <ToastContainer />
      </div>
    </MobileNavProvider>
  )
}
