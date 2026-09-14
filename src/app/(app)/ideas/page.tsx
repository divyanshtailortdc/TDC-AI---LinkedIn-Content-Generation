import { db } from '@/db'
import { accountsTable, ideasTable } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { IdeasClient } from './ideas-client'

export const dynamic = 'force-dynamic'

export default async function IdeasPage() {
  const [ideasRaw, accounts] = await Promise.all([
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
        createdAt: ideasTable.createdAt,
        accountName: accountsTable.name
      })
      .from(ideasTable)
      .leftJoin(accountsTable, eq(ideasTable.accountId, accountsTable.id))
      .orderBy(desc(ideasTable.createdAt)),
    db
      .select({
        id: accountsTable.id,
        name: accountsTable.name
      })
      .from(accountsTable)
  ])

  const formattedIdeas = ideasRaw.map((item) => ({
    ...item,
    accountName: item.accountName || 'Unknown Identity'
  }))

  return <IdeasClient initialIdeas={formattedIdeas} accounts={accounts} />
}
