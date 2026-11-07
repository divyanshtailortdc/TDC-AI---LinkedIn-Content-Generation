import 'server-only'

import { db } from '@/db'
import {
  goalsTable,
  ideasTable,
  linkedinPublicationsTable,
  postDraftsTable,
  schedulesTable
} from '@/db/schema'
import { monthGridRange, type Month } from '@/lib/calendar'
import { linkedInPublishConfig } from '@/lib/linkedin/config'
import { nextSlot } from '@/lib/schedule-time'
import {
  and,
  between,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  sql,
  type SQL
} from 'drizzle-orm'

/** The next automatic run: an instant, its weekday and the zone it is read in. */
export type NextRun = { at: string; weekday: number; zone: string }

/** A post as the Schedule page shows it. */
export type PlannedPost = {
  id: string
  hook: string
  status: string
  /** YYYY-MM-DD, or null when not planned yet. */
  plannedFor: string | null
  postedAt: Date | null
  /** Published (or being published) through the LinkedIn API: it stays posted. */
  publishedOnLinkedIn: boolean
  goalTitle: string | null
  createdAt: Date
}

/** Not planned yet, newest first; the list stops here. */
const UNSCHEDULED_LIMIT = 50

/** Posts still headed for LinkedIn: in review or approved, not yet posted. */
const unpostedStatuses = inArray(postDraftsTable.status, [
  'awaiting_review',
  'approved'
])

/**
 * Whether the post has a publication in flight or out, the rule setPostPosted
 * refuses "not posted" by. Plain false when publishing is not set up, so the
 * page does not depend on its table.
 */
function publishedOnLinkedIn(linkedIn: boolean) {
  if (!linkedIn) return sql<boolean>`false`
  return exists(
    db
      .select({ id: linkedinPublicationsTable.id })
      .from(linkedinPublicationsTable)
      .where(
        and(
          eq(linkedinPublicationsTable.draftId, postDraftsTable.id),
          inArray(linkedinPublicationsTable.status, ['publishing', 'published'])
        )
      )
  ).mapWith(Boolean)
}

function selectPosts(where: SQL | undefined, linkedIn: boolean) {
  return db
    .select({
      id: postDraftsTable.id,
      hook: postDraftsTable.hook,
      status: postDraftsTable.status,
      plannedFor: postDraftsTable.plannedFor,
      postedAt: postDraftsTable.postedAt,
      publishedOnLinkedIn: publishedOnLinkedIn(linkedIn),
      // The goal as titled now; once deleted, as it was when the idea was made.
      goalTitle: sql<
        string | null
      >`coalesce(${goalsTable.title}, ${ideasTable.goalSnapshot}->>'title')`,
      createdAt: postDraftsTable.createdAt
    })
    .from(postDraftsTable)
    .leftJoin(ideasTable, eq(ideasTable.id, postDraftsTable.ideaId))
    .leftJoin(goalsTable, eq(goalsTable.id, ideasTable.goalId))
    .where(where)
}

/** When the saved schedule next starts a run, as the form shows it. */
function nextRunOf(
  schedule: typeof schedulesTable.$inferSelect | undefined
): NextRun | null {
  if (!schedule?.enabled) return null
  const next = nextSlot(schedule, new Date())
  return next
    ? { at: next.slot.toISOString(), weekday: next.weekday, zone: next.zone }
    : null
}

/**
 * Everything the Schedule page shows for one month: the posts planned on the
 * days its grid covers, posts not planned yet, and the automatic schedule.
 * Rejected posts are never shown.
 */
export async function loadSchedulePage(accountId: string, month: Month) {
  const { from, to } = monthGridRange(month)
  const ofAccount = eq(postDraftsTable.accountId, accountId)
  const linkedIn = linkedInPublishConfig() !== null

  const [planned, unscheduled, [unscheduledTotal], schedule, goals] =
    await Promise.all([
      selectPosts(
        and(
          ofAccount,
          ne(postDraftsTable.status, 'rejected'),
          between(postDraftsTable.plannedFor, from, to)
        ),
        linkedIn
      ).orderBy(postDraftsTable.plannedFor, postDraftsTable.createdAt),
      selectPosts(
        and(
          ofAccount,
          unpostedStatuses,
          isNull(postDraftsTable.plannedFor),
          isNull(postDraftsTable.postedAt)
        ),
        linkedIn
      )
        .orderBy(desc(postDraftsTable.createdAt), desc(postDraftsTable.id))
        .limit(UNSCHEDULED_LIMIT),
      db
        .select({ n: count() })
        .from(postDraftsTable)
        .where(
          and(
            ofAccount,
            unpostedStatuses,
            isNull(postDraftsTable.plannedFor),
            isNull(postDraftsTable.postedAt)
          )
        ),
      db.query.schedulesTable.findFirst({
        where: eq(schedulesTable.accountId, accountId)
      }),
      // The goals a scheduled run can serve, newest first.
      db
        .select({
          id: goalsTable.id,
          title: goalsTable.title,
          objective: goalsTable.objective
        })
        .from(goalsTable)
        .where(
          and(
            eq(goalsTable.accountId, accountId),
            eq(goalsTable.isActive, true)
          )
        )
        .orderBy(desc(goalsTable.createdAt))
    ])

  return {
    planned: planned as PlannedPost[],
    unscheduled: unscheduled as PlannedPost[],
    unscheduledTotal: unscheduledTotal?.n ?? 0,
    schedule: schedule ?? null,
    nextRun: nextRunOf(schedule),
    goals
  }
}
