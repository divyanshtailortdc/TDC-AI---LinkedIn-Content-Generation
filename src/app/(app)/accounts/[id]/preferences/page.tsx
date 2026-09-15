import { notFound } from 'next/navigation'
import { db } from '@/db'
import { accountsTable, preferencesTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { PreferencesForm } from './preferences-form'
import { AccountHeader } from '@/components/account-header'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function PreferencesPage({ params }: PageProps) {
  const { id } = await params

  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, id)
  })

  if (!account) {
    notFound()
  }

  const [existingPreferences] = await db
    .select()
    .from(preferencesTable)
    .where(eq(preferencesTable.accountId, id))

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <AccountHeader account={account} />
      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="max-w-5xl mx-auto">
          <PreferencesForm
            accountId={account.id}
            accountName={account.name}
            existingPreferences={existingPreferences || null}
          />
        </div>
      </div>
    </div>
  )
}
