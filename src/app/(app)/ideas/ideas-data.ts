import 'server-only'

import { db } from '@/db'
import { goalsTable, ideasTable, runsTable } from '@/db/schema'
import { ideaGoalTitles } from '@/lib/ai/context-blocks'
import { loadPage, PAGE_SIZE } from '@/lib/pagination'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
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

  const [{ rows, pageInfo }, statusCounts, undecided, goals] = await Promise.all([
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
            // Titled from the goals below (see ideaGoalTitles).
            goalId: ideasTable.goalId,
            goalIds: ideasTable.goalIds,
            goalSnapshot: ideasTable.goalSnapshot,
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
          .where(shown)
          .orderBy(desc(ideasTable.createdAt), desc(ideasTable.id))
          .offset(offset)
          .limit(limit)
    }),
    counts,
    db
      .select({ id: ideasTable.id, status: ideasTable.status })
      .from(ideasTable)
      .where(and(ofAccount, inArray(ideasTable.status, ['proposed', 'approved']))),
    db
      .select({ id: goalsTable.id, title: goalsTable.title })
      .from(goalsTable)
      .where(eq(goalsTable.accountId, accountId))
  ])

  return {
    ideas: rows.map(({ goalId, goalIds, goalSnapshot, ...idea }) => ({
      ...idea,
      // Every goal the idea serves, its main goal first.
      goalTitles: ideaGoalTitles({ goalId, goalIds, goalSnapshot }, goals)
    })),
    pageInfo,
    statusCounts,
    proposedIds: undecided.filter(i => i.status === 'proposed').map(i => i.id),
    approvedIds: undecided.filter(i => i.status === 'approved').map(i => i.id)
  }
}
