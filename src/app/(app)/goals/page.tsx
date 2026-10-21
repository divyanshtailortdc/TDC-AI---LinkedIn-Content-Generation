import { NoIdentity } from '@/components/no-identity'
import { db } from '@/db'
import { goalsTable, ideasTable, postDraftsTable } from '@/db/schema'
import { getIdentity } from '@/lib/identity'
import { loadRunPicker } from '@/lib/run-picker'
import { desc, eq, sql } from 'drizzle-orm'
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
    // An idea counts for every goal it serves, not only its main one.
    db.execute<{ goal_id: string; ideas: number; posts: number }>(sql`
      select served.goal_id,
        count(distinct ${ideasTable.id})::int as ideas,
        count(distinct ${postDraftsTable.id})::int as posts
      from ${ideasTable}
      cross join lateral jsonb_array_elements_text(${ideasTable.goalIds}) as served(goal_id)
      left join ${postDraftsTable} on ${postDraftsTable.ideaId} = ${ideasTable.id}
      where ${ideasTable.accountId} = ${identity.id}
      group by served.goal_id
    `),
    loadRunPicker(identity.id)
  ])

  const usage = Object.fromEntries(
    [...usageRows].map(r => [r.goal_id, { ideas: r.ideas, posts: r.posts }])
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
