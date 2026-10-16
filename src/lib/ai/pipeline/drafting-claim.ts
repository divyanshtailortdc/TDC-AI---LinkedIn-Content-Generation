import { ideasTable } from '@/db/schema'
import { and, eq, lt, or } from 'drizzle-orm'
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
