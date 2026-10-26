import { ideasTable } from '@/db/schema'
import { and, eq, inArray, lt, notInArray, or } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

/**
 * Drafting an idea makes exactly one post. A retry, a double click or two
 * tabs each used to draft every idea they were sent, so the same idea came
 * back as several posts. Each idea is now claimed before any model call
 * (approved -> drafting) with a conditional update, so only one caller gets
 * it; the post is saved in the same transaction that moves the idea from
 * drafting to drafted, and a failed draft hands the idea back as approved.
 *
 * Takes the database as an argument (rather than importing it) so the steps
 * can be run against any connection.
 */
export type DraftingDb = PgDatabase<PostgresJsQueryResultHKT, any, any>

/**
 * A claim older than this is taken to belong to a process that died part way
 * (a deploy, a crash), so the idea may be claimed again. Comfortably longer
 * than a draft with a revision pass and an image takes.
 */
export const DRAFTING_CLAIM_TTL_MS = 15 * 60 * 1000

/**
 * Claims an approved idea for drafting. Returns false when the idea is not
 * approved: already drafted, being drafted by another request, or rejected.
 */
export async function claimIdeaForDrafting(
  database: DraftingDb,
  ideaId: string,
  now = new Date()
): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - DRAFTING_CLAIM_TTL_MS)
  const claimed = await database
    .update(ideasTable)
    .set({ status: 'drafting', updatedAt: now })
    .where(
      and(
        eq(ideasTable.id, ideaId),
        or(
          eq(ideasTable.status, 'approved'),
          and(
            eq(ideasTable.status, 'drafting'),
            lt(ideasTable.updatedAt, staleBefore)
          )
        )
      )
    )
    .returning({ id: ideasTable.id })
  return claimed.length > 0
}

/**
 * Claims held by the drafting queue (src/jobs/drafting-queue.ts) are touched
 * this often while the idea waits or is drafted, so a claim that stops being
 * touched for DRAFTING_ABANDONED_AFTER_MS belongs to a process that has gone
 * (a deploy, a crash) and its idea can be taken over and drafted.
 */
export const DRAFTING_HEARTBEAT_MS = 30 * 1000
export const DRAFTING_ABANDONED_AFTER_MS = 2 * 60 * 1000

/** Keeps the claims on ideas this process holds fresh; see DRAFTING_HEARTBEAT_MS. */
export async function touchDraftingClaims(
  database: DraftingDb,
  ideaIds: string[]
): Promise<void> {
  if (ideaIds.length === 0) return
  await database
    .update(ideasTable)
    .set({ updatedAt: new Date() })
    .where(
      and(inArray(ideasTable.id, ideaIds), eq(ideasTable.status, 'drafting'))
    )
}

/**
 * Takes over claims nobody has touched for DRAFTING_ABANDONED_AFTER_MS, except
 * the ones this process holds. The touch is the take-over, so of two callers
 * only one gets each idea.
 */
export async function takeOverAbandonedDraftingClaims(
  database: DraftingDb,
  heldIds: string[],
  now = new Date()
): Promise<Array<{ id: string; runId: string | null }>> {
  const abandonedBefore = new Date(now.getTime() - DRAFTING_ABANDONED_AFTER_MS)
  return database
    .update(ideasTable)
    .set({ updatedAt: now })
    .where(
      and(
        eq(ideasTable.status, 'drafting'),
        lt(ideasTable.updatedAt, abandonedBefore),
        heldIds.length > 0 ? notInArray(ideasTable.id, heldIds) : undefined
      )
    )
    .returning({ id: ideasTable.id, runId: ideasTable.runId })
}

/** Hands a claimed idea back after a failed draft, so it can be drafted again. */
export async function releaseDraftingClaim(
  database: DraftingDb,
  ideaId: string
): Promise<void> {
  await database
    .update(ideasTable)
    .set({ status: 'approved', updatedAt: new Date() })
    .where(and(eq(ideasTable.id, ideaId), eq(ideasTable.status, 'drafting')))
}

/**
 * Marks a claimed idea drafted. Run it first inside the transaction that
 * saves the post: it locks the idea's row, so a second save for the same idea
 * waits, finds it already drafted, and throws, rolling its post back.
 */
export async function markIdeaDrafted(
  tx: DraftingDb,
  ideaId: string
): Promise<void> {
  const updated = await tx
    .update(ideasTable)
    .set({ status: 'drafted', updatedAt: new Date() })
    .where(and(eq(ideasTable.id, ideaId), eq(ideasTable.status, 'drafting')))
    .returning({ id: ideasTable.id })
  if (updated.length === 0) {
    throw new Error(
      `Idea ${ideaId} is no longer being drafted; its post was not saved`
    )
  }
}
