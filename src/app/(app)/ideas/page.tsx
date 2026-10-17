import { db } from '@/db'
import { ideasTable } from '@/db/schema'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { IdeasClient } from './ideas-client'
import { getActiveAccount } from '@/lib/active-account'
import { loadPage, PAGE_SIZE, parsePage } from '@/lib/pagination'
import { NoActiveAccount } from '@/components/no-active-account'
import { parseStatusFilter, statusFilterCounts } from './status-filter'

export const dynamic = 'force-dynamic'

export default async function IdeasPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const activeAccount = await getActiveAccount()

  if (!activeAccount) {
    return <NoActiveAccount title="Idea Approval Gate" />
  }

  const params = await searchParams
  const status = parseStatusFilter(params.status)
  const ofAccount = eq(ideasTable.accountId, activeAccount.id)
  const shown =
    status === 'all' ? ofAccount : and(ofAccount, eq(ideasTable.status, status))

  // One grouped query gives the filter menu's counts and the page total.
  const counts = db
    .select({ status: ideasTable.status, n: count() })
    .from(ideasTable)
    .where(ofAccount)
    .groupBy(ideasTable.status)
    .then(statusFilterCounts)

  const [{ rows, pageInfo }, statusCounts, undecided] = await Promise.all([
    loadPage({
      page: parsePage(params.page),
      pageSize: PAGE_SIZE,
      count: () => counts.then(c => c[status]),
      rows: (offset, limit) =>
        db
          .select({
            id: ideasTable.id,
            accountId: ideasTable.accountId,
            title: ideasTable.title,
            thesis: ideasTable.thesis,
            perspectiveAngle: ideasTable.perspectiveAngle,
            angle: ideasTable.angle,
            pillar: ideasTable.pillar,
            whyNow: ideasTable.whyNow,
            hookConcept: ideasTable.hookConcept,
            coreArgument: ideasTable.coreArgument,
            audienceTakeaway: ideasTable.audienceTakeaway,
            supportingEvidence: ideasTable.supportingEvidence,
            suggestedMedia: ideasTable.suggestedMedia,
            noveltyNote: ideasTable.noveltyNote,
            score: ideasTable.score,
            groundingScore: ideasTable.groundingScore,
            originalityScore: ideasTable.originalityScore,
            unsupportedClaims: ideasTable.unsupportedClaims,
            sourceIds: ideasTable.sourceIds,
            risks: ideasTable.risks,
            status: ideasTable.status,
            createdAt: ideasTable.createdAt
          })
          .from(ideasTable)
          .where(shown)
          .orderBy(desc(ideasTable.createdAt), desc(ideasTable.id))
          .offset(offset)
          .limit(limit)
    }),
    counts,
    // Approve all and Create posts act on every idea waiting on them, not
    // only the ones on this page, so their ids come from the whole list.
    db
      .select({ id: ideasTable.id, status: ideasTable.status })
      .from(ideasTable)
      .where(and(ofAccount, inArray(ideasTable.status, ['proposed', 'approved'])))
  ])

  // Keying on the active account forces a remount on switch, so this client
  // component's local state resets and reflects the newly active account's
  // data instead of stale state.
  return (
    <IdeasClient
      key={activeAccount.id}
      initialIdeas={rows}
      pageInfo={pageInfo}
      status={status}
      statusCounts={statusCounts}
      proposedIds={undecided.filter(i => i.status === 'proposed').map(i => i.id)}
      approvedIds={undecided.filter(i => i.status === 'approved').map(i => i.id)}
      activeAccount={activeAccount}
    />
  )
}
