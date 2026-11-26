import 'server-only'

import { db } from '@/db'
import { goalsTable, ideasTable, postDraftsTable, runsTable } from '@/db/schema'
import { ideaGoalTitles } from '@/lib/ai/context-blocks'
import { formatsOfPlatform, PLATFORM_IDS, type PlatformId } from '@/lib/formats'
import { inKnownFormat } from '@/lib/known-formats'
import { loadPage, PAGE_SIZE } from '@/lib/pagination'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { accountNameAtRunSql, runGoalTitlesSql } from '../runs/runs-data'
import { statusFilterCounts, type StatusFilter } from './status-filter'
import type { SharedPostRef } from '@/lib/reference-post/types'

/** Ideas aimed at `platform`: one of its formats is among their target formats. */
function onPlatform(platform: PlatformId) {
  const formats = formatsOfPlatform(platform)
  return sql`${ideasTable.targetFormats} ?| array[${sql.join(
    formats.map(f => sql`${f}`),
    sql`, `
  )}]::text[]`
}

/** Per status, how many ideas there are, in all and on each platform. */
type StatusRow = { status: string; n: number } & Record<PlatformId, number>

/**
 * One page of an account's ideas under a status filter and, optionally, one
 * platform, newest first; and what the page needs to know about all of
 * them: the filter menu's counts, each platform tab's count, the platforms
 * that have ideas, and the ids Approve all and Create posts act on, on
 * whatever page they are (only the platform's, when one is shown).
 */
export async function loadIdeasPage(
  accountId: string,
  {
    status,
    page,
    platform = null
  }: { status: StatusFilter; page: number; platform?: PlatformId | null }
) {
  const ofAccount = eq(ideasTable.accountId, accountId)
  const inScope = platform ? and(ofAccount, onPlatform(platform)) : ofAccount
  const shown =
    status === 'all' ? inScope : and(inScope, eq(ideasTable.status, status))

  // One grouped query gives the filter menu's counts, the page total and
  // the platform tabs' counts.
  const grouped = db
    .select({
      status: ideasTable.status,
      n: sql<number>`count(*)::int`,
      ...Object.fromEntries(
        PLATFORM_IDS.map(p => [
          p,
          sql<number>`(count(*) filter (where ${onPlatform(p)}))::int`
        ])
      )
    })
    .from(ideasTable)
    .where(ofAccount)
    .groupBy(ideasTable.status)
    .then(rows => rows as unknown as StatusRow[])
  const counts = grouped.then(rows =>
    statusFilterCounts(
      rows.map(row => ({ status: row.status, n: platform ? row[platform] : row.n }))
    )
  )

  const [{ rows, pageInfo }, statusCounts, statusRows, undecided, goals] = await Promise.all([
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
            goalFitScore: ideasTable.goalFitScore,
            goalFitNote: ideasTable.goalFitNote,
            scorecard: ideasTable.scorecard,
            unsupportedClaims: ideasTable.unsupportedClaims,
            sourceIds: ideasTable.sourceIds,
            risks: ideasTable.risks,
            status: ideasTable.status,
            formatFit: ideasTable.formatFit,
            // The post an idea from "From a link" was made from; only where
            // it is and what it is reach the page, not its text.
            reference: sql<SharedPostRef | null>`case when ${ideasTable.reference} is null then null else jsonb_build_object('url', ${ideasTable.reference}->>'url', 'source', ${ideasTable.reference}->>'source', 'kind', ${ideasTable.reference}->>'kind', 'author', ${ideasTable.reference}->>'author') end`,
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
    grouped,
    db
      .select({ id: ideasTable.id, status: ideasTable.status })
      .from(ideasTable)
      .where(and(inScope, inArray(ideasTable.status, ['proposed', 'approved']))),
    db
      .select({ id: goalsTable.id, title: goalsTable.title })
      .from(goalsTable)
      .where(eq(goalsTable.accountId, accountId))
  ])

  // The formats each drafted idea on the page has posts in: shown on its
  // card, and Create posts offers it the other platforms.
  const draftedIds = rows.filter(i => i.status === 'drafted').map(i => i.id)
  const postFormats = new Map<string, string[]>()
  if (draftedIds.length > 0) {
    const posts = await db
      .select({ ideaId: postDraftsTable.ideaId, formatId: postDraftsTable.formatId })
      .from(postDraftsTable)
      .where(and(inArray(postDraftsTable.ideaId, draftedIds), inKnownFormat()))
    for (const post of posts) {
      if (!post.ideaId) continue
      const formats = postFormats.get(post.ideaId) ?? []
      if (!formats.includes(post.formatId)) formats.push(post.formatId)
      postFormats.set(post.ideaId, formats)
    }
  }

  // The platform tabs count the ideas under the status filter.
  const underStatus = statusRows.filter(
    row => status === 'all' || row.status === status
  )
  const sum = (pick: (row: StatusRow) => number, list = underStatus) =>
    list.reduce((total, row) => total + pick(row), 0)

  return {
    platformCounts: {
      all: sum(row => row.n),
      byPlatform: Object.fromEntries(
        PLATFORM_IDS.map(p => [p, sum(row => row[p])])
      ) as Record<PlatformId, number>
    },
    /** Platforms with ideas in any status, whether or not they are still turned on. */
    platformsWithIdeas: PLATFORM_IDS.filter(p => sum(row => row[p], statusRows) > 0),
    ideas: rows.map(({ goalId, goalIds, goalSnapshot, ...idea }) => ({
      ...idea,
      // Every goal the idea serves, its main goal first.
      goalTitles: ideaGoalTitles({ goalId, goalIds, goalSnapshot }, goals),
      postFormats: postFormats.get(idea.id) ?? []
    })),
    pageInfo,
    statusCounts,
    proposedIds: undecided.filter(i => i.status === 'proposed').map(i => i.id),
    approvedIds: undecided.filter(i => i.status === 'approved').map(i => i.id)
  }
}
