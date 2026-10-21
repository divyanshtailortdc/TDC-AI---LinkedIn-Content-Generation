import 'server-only'

import { db } from '@/db'
import { goalsTable, ideasTable, runsTable } from '@/db/schema'
import { loadPage, PAGE_SIZE } from '@/lib/pagination'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { accountNameAtRunSql, runGoalTitlesSql } from '../runs/runs-data'
import { statusFilterCounts, type StatusFilter } from './status-filter'

/**
 * One page of an account's ideas under a status filter, newest first, and
 * what the page needs to know about all of them: the filter menu's counts,
 * and the ids Approve all and Create posts act on, on whatever page they are.
 */
export async function loadIdeasPage(
  accountId: string,
  { status, page }: { status: StatusFilter; page: number }
) {
  const ofAccount = eq(ideasTable.accountId, accountId)
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
      page,
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
            // The goal as titled now; once deleted, as it was when the idea was made.
            goalTitle: sql<
              string | null
            >`coalesce(${goalsTable.title}, ${ideasTable.goalSnapshot}->>'title')`,
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
            createdAt: ideasTable.createdAt,
            // Which run made the idea, so ideas from different runs (and from
            // before the identity was renamed) can be told apart.
            runId: ideasTable.runId,
            runCreatedAt: runsTable.createdAt,
            runAccountName: accountNameAtRunSql,
            runGoalTitles: runGoalTitlesSql
          })
          .from(ideasTable)
          .leftJoin(runsTable, eq(runsTable.id, ideasTable.runId))
          .leftJoin(goalsTable, eq(goalsTable.id, ideasTable.goalId))
          .where(shown)
          .orderBy(desc(ideasTable.createdAt), desc(ideasTable.id))
          .offset(offset)
          .limit(limit)
    }),
    counts,
    db
      .select({ id: ideasTable.id, status: ideasTable.status })
      .from(ideasTable)
      .where(and(ofAccount, inArray(ideasTable.status, ['proposed', 'approved'])))
  ])

  return {
    ideas: rows,
    pageInfo,
    statusCounts,
    proposedIds: undecided.filter(i => i.status === 'proposed').map(i => i.id),
    approvedIds: undecided.filter(i => i.status === 'approved').map(i => i.id)
  }
}
