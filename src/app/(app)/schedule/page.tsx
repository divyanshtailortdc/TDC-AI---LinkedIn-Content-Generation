import { NoIdentity } from '@/components/no-identity'
import { localDay, parseMonthParam } from '@/lib/calendar'
import { getIdentity } from '@/lib/identity'
import { ScheduleClient } from './schedule-client'
import { loadSchedulePage } from './schedule-data'

export const dynamic = 'force-dynamic'

export default async function SchedulePage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Schedule" />

  // The month in the URL (?month=2026-10), or this one on the server's clock;
  // the page moves to the viewer's own month from there.
  const today = localDay()
  const month = parseMonthParam((await searchParams).month, {
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7))
  })
  const data = await loadSchedulePage(identity.id, month)

  return (
    <ScheduleClient
      key={`${month.year}-${month.month}`}
      accountId={identity.id}
      month={month}
      {...data}
    />
  )
}
