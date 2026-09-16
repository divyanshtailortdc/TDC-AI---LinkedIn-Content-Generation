import { db } from '@/db'
import { ideasTable } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { IdeasClient } from './ideas-client'
import { getActiveAccount } from '@/lib/active-account'
import { NoActiveAccount } from '@/components/no-active-account'

export const dynamic = 'force-dynamic'

export default async function IdeasPage() {
  const activeAccount = await getActiveAccount()

  if (!activeAccount) {
    return <NoActiveAccount title="Idea Approval Gate" />
  }

  const ideasRaw = await db
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
    .where(eq(ideasTable.accountId, activeAccount.id))
    .orderBy(desc(ideasTable.createdAt))

  // Keying on the active account forces a remount on switch, so this client
  // component's local state (which only seeds from initialIdeas once) resets
  // and reflects the newly active account's data instead of stale state.
  return (
    <IdeasClient key={activeAccount.id} initialIdeas={ideasRaw} activeAccount={activeAccount} />
  )
}
