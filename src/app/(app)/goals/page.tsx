import { NoIdentity } from '@/components/no-identity'
import { db } from '@/db'
import { goalsTable, ideasTable, postDraftsTable } from '@/db/schema'
import { getIdentity } from '@/lib/identity'
import { loadRunPicker } from '@/lib/run-picker'
import { and, count, countDistinct, desc, eq, isNotNull } from 'drizzle-orm'
import { GoalsClient } from './goals-client'

export const dynamic = 'force-dynamic'

export default async function GoalsPage() {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Goals" />

  const [goals, usageRows, picker] = await Promise.all([
    db
      .select()
      .from(goalsTable)
      .where(eq(goalsTable.accountId, identity.id))
      .orderBy(desc(goalsTable.createdAt)),
    // How much each goal has produced, so a goal that is doing nothing shows.
    db
      .select({
        goalId: ideasTable.goalId,
        ideas: countDistinct(ideasTable.id),
        posts: count(postDraftsTable.id)
      })
      .from(ideasTable)
      .leftJoin(postDraftsTable, eq(postDraftsTable.ideaId, ideasTable.id))
      .where(
        and(eq(ideasTable.accountId, identity.id), isNotNull(ideasTable.goalId))
      )
      .groupBy(ideasTable.goalId),
    loadRunPicker(identity.id)
  ])

  const usage = Object.fromEntries(
    usageRows.map(r => [r.goalId!, { ideas: r.ideas, posts: r.posts }])
  )

  return (
    <GoalsClient
      accountId={identity.id}
      initialGoals={goals}
      usage={usage}
      picker={picker}
    />
  )
}
