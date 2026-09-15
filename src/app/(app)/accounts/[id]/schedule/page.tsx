import { db } from '@/db'
import { accountsTable, schedulesTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { AccountHeader } from '@/components/account-header'
import { ScheduleForm } from './schedule-form'

export const dynamic = 'force-dynamic'

interface SchedulePageProps {
  params: Promise<{ id: string }>
}

export default async function SchedulePage({ params }: SchedulePageProps) {
  const { id } = await params

  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, id)
  })

  if (!account) {
    notFound()
  }

  const schedule = await db.query.schedulesTable.findFirst({
    where: eq(schedulesTable.accountId, id)
  })

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <AccountHeader account={account} />
      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="max-w-5xl mx-auto space-y-6">
          <ScheduleForm accountId={account.id} initialSchedule={schedule} />
        </div>
      </div>
    </div>
  )
}
