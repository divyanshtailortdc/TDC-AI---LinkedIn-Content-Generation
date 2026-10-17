import 'server-only'

import { db } from '@/db'
import { ideasTable } from '@/db/schema'
import { olderThan } from '@/lib/db-pagination'
import { PAGE_SIZE, pageOf } from '@/lib/pagination'
import { and, count, desc, eq } from 'drizzle-orm'

/** One page of an account's ideas, newest first, and where the next one starts. */
export async function loadIdeasPage(accountId: string, cursorId?: string | null) {
  const rows = await db
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
    .where(
      and(
        eq(ideasTable.accountId, accountId),
        cursorId
          ? olderThan(ideasTable, ideasTable.createdAt, ideasTable.id, cursorId)
          : undefined
      )
    )
    .orderBy(desc(ideasTable.createdAt), desc(ideasTable.id))
    .limit(PAGE_SIZE + 1)

  const { items, nextCursor } = pageOf(rows)
  return { ideas: items, nextCursor }
}

export async function countIdeas(accountId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(ideasTable)
    .where(eq(ideasTable.accountId, accountId))
  return row?.total ?? 0
}
