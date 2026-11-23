import 'server-only'

import { db } from '@/db'
import { runsTable } from '@/db/schema'
import { loadPage, PAGE_SIZE } from '@/lib/pagination'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  RUN_FILTER_STATUSES,
  runFilterCounts,
  type RunFilter
} from './run-display'

/**
 * The name the identity had when the run started. The identity can be renamed
 * afterwards, and old runs must keep the name they ran under. Needs `runs` in
 * the query's FROM clause.
 */
export const accountNameAtRunSql = sql<string | null>`(
  select s.response_json->>'account'
  from run_steps s
  where s.run_id = runs.id and s.stage = 'gathering_context'
  order by s.started_at
  limit 1
)`

/**
 * Titles of the goals picked for the run, in the order they were picked. A
 * goal deleted since drops out. Needs `runs` in the query's FROM clause.
 *
 * The picked id is cast, not `g.id`, so each goal is found through its primary
 * key. Runs only store ids of the identity's own goals (see enqueueRun).
 */
export const runGoalTitlesSql = sql<string[]>`(
  select coalesce(jsonb_agg(g.title order by picked.ord), '[]'::jsonb)
  from jsonb_array_elements_text(coalesce(runs.goal_ids, '[]'::jsonb))
    with ordinality as picked(id, ord)
  join goals g on g.id = picked.id::uuid and g.account_id = runs.account_id
)`

export type RunIdeaCounts = {
  total: number
  proposed: number
  approved: number
  drafting: number
  drafted: number
  rejected: number
}

/**
 * How many ideas the run saved, by status, so the list can say "6 ideas · 4
 * to review" without opening the run. Needs `runs` in the query's FROM clause.
 */
const runIdeaCountsSql = sql<RunIdeaCounts>`(
  select jsonb_build_object(
    'total', count(*),
    'proposed', count(*) filter (where i.status = 'proposed'),
    'approved', count(*) filter (where i.status = 'approved'),
    'drafting', count(*) filter (where i.status = 'drafting'),
    'drafted', count(*) filter (where i.status = 'drafted'),
    'rejected', count(*) filter (where i.status = 'rejected')
  )
  from ideas i
  where i.run_id = runs.id
)`

/**
 * One page of an account's runs, newest first, for the Runs lists, showing
 * the runs `filter` picks. Also how many runs each filter would show, and
 * the account's newest run of any status, which the list polls against to
 * notice a run started elsewhere.
 */
export async function loadRunsPage(
  accountId: string,
  page: number,
  filter: RunFilter = 'all'
) {
  const ofAccount = eq(runsTable.accountId, accountId)
  const where =
    filter === 'all'
      ? ofAccount
      : and(ofAccount, inArray(runsTable.status, RUN_FILTER_STATUSES[filter]))

  // One group-by gives every filter's count, the page's total among them.
  const counted = db
    .select({ status: runsTable.status, n: count() })
    .from(runsTable)
    .where(ofAccount)
    .groupBy(runsTable.status)
    .then(runFilterCounts)

  const [list, counts, [latest]] = await Promise.all([
    loadPage({
      page,
      pageSize: PAGE_SIZE,
      count: async () => (await counted)[filter],
      rows: (offset, limit) =>
        db
          .select({
            id: runsTable.id,
            accountId: runsTable.accountId,
            workflow: runsTable.workflow,
            trigger: runsTable.trigger,
            channel: runsTable.channel,
            status: runsTable.status,
            currentStep: runsTable.currentStep,
            totalSteps: runsTable.totalSteps,
            costUsd: runsTable.costUsd,
            tokenCounts: runsTable.tokenCounts,
            error: runsTable.error,
            createdAt: runsTable.createdAt,
            accountNameAtRun: accountNameAtRunSql,
            goalTitles: runGoalTitlesSql,
            ideaCounts: runIdeaCountsSql
          })
          .from(runsTable)
          .where(where)
          .orderBy(desc(runsTable.createdAt), desc(runsTable.id))
          .offset(offset)
          .limit(limit)
    }),
    counted,
    db
      .select({ id: runsTable.id })
      .from(runsTable)
      .where(ofAccount)
      .orderBy(desc(runsTable.createdAt), desc(runsTable.id))
      .limit(1)
  ])
  return { ...list, counts, latestRunId: latest?.id ?? null }
}
