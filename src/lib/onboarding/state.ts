import { onboardingProgressTable } from '@/db/schema'
import type { PublishingDb } from '@/lib/publishing/connection'
import { sql } from 'drizzle-orm'
import {
  CONFIRMABLE_STEPS,
  SKIPPABLE_STEPS,
  type OnboardingStepKey
} from './progress'

/**
 * Writes what the onboarding guide keeps of its own (onboarding_progress):
 * steps skipped, defaults confirmed, the guide put away. One row per
 * identity, made by the first write. Each list change is a single upsert on
 * the row, so two tabs confirming at once cannot lose either one. No
 * `server-only`, so the DB test can pass its own connection.
 */

export type OnboardingChange =
  | { skip: OnboardingStepKey }
  | { unskip: OnboardingStepKey }
  | { confirm: OnboardingStepKey }
  | { hidden: boolean }

export class OnboardingChangeError extends Error {}

/** `list` with `key` added once (a jsonb array of strings). */
const added = (
  list:
    | typeof onboardingProgressTable.skipped
    | typeof onboardingProgressTable.confirmed,
  key: string
) =>
  sql`case when ${list} ? ${key} then ${list} else ${list} || jsonb_build_array(${key}::text) end`

export async function changeOnboarding(
  database: PublishingDb,
  accountId: string,
  change: OnboardingChange
): Promise<void> {
  const now = new Date()
  const table = onboardingProgressTable
  if ('skip' in change || 'unskip' in change) {
    const key = 'skip' in change ? change.skip : change.unskip
    if (!SKIPPABLE_STEPS.has(key)) {
      throw new OnboardingChangeError('This step cannot be skipped.')
    }
    const skipping = 'skip' in change
    await database
      .insert(table)
      .values({ accountId, skipped: skipping ? [key] : [] })
      .onConflictDoUpdate({
        target: table.accountId,
        set: {
          skipped: skipping
            ? added(table.skipped, key)
            : sql`${table.skipped} - ${key}::text`,
          updatedAt: now
        }
      })
    return
  }
  if ('confirm' in change) {
    if (!CONFIRMABLE_STEPS.has(change.confirm)) {
      throw new OnboardingChangeError('This step is done by saving it.')
    }
    await database
      .insert(table)
      .values({ accountId, confirmed: [change.confirm] })
      .onConflictDoUpdate({
        target: table.accountId,
        set: {
          confirmed: added(table.confirmed, change.confirm),
          updatedAt: now
        }
      })
    return
  }
  const hiddenAt = change.hidden ? now : null
  await database
    .insert(table)
    .values({ accountId, hiddenAt })
    .onConflictDoUpdate({
      target: table.accountId,
      set: { hiddenAt, updatedAt: now }
    })
}

/**
 * Records when the first post went out, the first time it is noticed. With
 * `hide`, the guide is put away too (an identity onboarded long ago, with
 * nothing left to say), so later pages need not work its progress out.
 */
export async function markOnboardingComplete(
  database: PublishingDb,
  accountId: string,
  { hide = false }: { hide?: boolean } = {}
): Promise<void> {
  const now = new Date()
  const table = onboardingProgressTable
  await database
    .insert(table)
    .values({ accountId, completedAt: now, hiddenAt: hide ? now : null })
    .onConflictDoUpdate({
      target: table.accountId,
      set: {
        completedAt: sql`coalesce(${table.completedAt}, ${now.toISOString()}::timestamptz)`,
        ...(hide && {
          hiddenAt: sql`coalesce(${table.hiddenAt}, ${now.toISOString()}::timestamptz)`
        }),
        updatedAt: now
      }
    })
}
