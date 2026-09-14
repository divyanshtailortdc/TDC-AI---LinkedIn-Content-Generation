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
    <div className="mx-auto max-w-5xl p-6 sm:p-8 space-y-6">
      <AccountHeader account={account} />
      <ScheduleForm accountId={account.id} initialSchedule={schedule} />
    </div>
  )
}
