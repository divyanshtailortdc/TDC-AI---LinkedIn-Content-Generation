import 'server-only'

import type { RunPickerData } from '@/components/generate-run-dialog'
import { db } from '@/db'
import { goalsTable, preferencesTable } from '@/db/schema'
import { resolvePreferences } from '@/lib/ai/context'
import { desc, eq } from 'drizzle-orm'

/**
 * The identity's goals, newest first, its ideas per run and the platforms it
 * posts on, for a run picker.
 */
export async function loadRunPicker(accountId: string): Promise<RunPickerData> {
  const [goals, [preferences]] = await Promise.all([
    db
      .select({
        id: goalsTable.id,
        title: goalsTable.title,
        objective: goalsTable.objective,
        keyMessage: goalsTable.keyMessage,
        platforms: goalsTable.platforms,
        isActive: goalsTable.isActive
      })
      .from(goalsTable)
      .where(eq(goalsTable.accountId, accountId))
      .orderBy(desc(goalsTable.createdAt)),
    db
      .select()
      .from(preferencesTable)
      .where(eq(preferencesTable.accountId, accountId))
  ])
  const prefs = resolvePreferences(preferences)
  return {
    goals,
    ideasPerRun: prefs.ideasPerRun,
    platforms: prefs.channels.platforms
  }
}
