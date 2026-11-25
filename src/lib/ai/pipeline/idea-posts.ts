import { postDraftsTable } from '@/db/schema'
import { inArray } from 'drizzle-orm'
import type { DraftingDb } from './drafting-claim'

/**
 * The formats of each idea's posts, every post whatever its status, as
 * stored: what drafting an idea again must not repeat
 * (src/lib/formats/drafted.ts). Takes the database (or a transaction) as an
 * argument so a save can read it under its lock.
 */
export async function existingPostFormats(
  database: DraftingDb,
  ideaIds: readonly string[]
): Promise<Map<string, string[]>> {
  const byIdea = new Map<string, string[]>()
  if (ideaIds.length === 0) return byIdea
  const rows = await database
    .select({
      ideaId: postDraftsTable.ideaId,
      formatId: postDraftsTable.formatId
    })
    .from(postDraftsTable)
    .where(inArray(postDraftsTable.ideaId, [...ideaIds]))
  for (const row of rows) {
    if (!row.ideaId) continue
    const formats = byIdea.get(row.ideaId) ?? []
    if (!formats.includes(row.formatId)) formats.push(row.formatId)
    byIdea.set(row.ideaId, formats)
  }
  return byIdea
}
