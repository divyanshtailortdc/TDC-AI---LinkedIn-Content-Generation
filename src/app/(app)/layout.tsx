import { Sidebar } from '@/components/sidebar'
import { ToastContainer } from '@/components/toast-notification'
import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getActiveAccount } from '@/lib/active-account'

export const dynamic = 'force-dynamic'

export default async function AppLayout({
  children
}: {
  children: React.ReactNode
}) {
  const [accounts, activeAccount] = await Promise.all([
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
    getActiveAccount()
  ])

  return (
    <div className="flex h-full min-h-screen">
      <Sidebar accounts={accounts} activeAccount={activeAccount} />
      <main className="flex-1 overflow-y-auto bg-background relative flex flex-col">
        {children}
      </main>
      <ToastContainer />
    </div>
  )
}
