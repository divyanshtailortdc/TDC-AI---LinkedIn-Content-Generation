'use server'

import { db } from '@/db'
import { platformInsightsTable } from '@/db/schema'
import { requireOwnedAccount } from '@/lib/account-guard'
import { isPlatformId, type PlatformId } from '@/lib/formats'
import { IDENTITY_PATH } from '@/lib/identity'
import {
  profileInsightViews,
  runProfileAnalysis,
  startProfileAnalysis
} from '@/lib/profile-insights/analyze'
import {
  cleanProfileInsights,
  effectiveStatus,
  type ProfileInsightView
} from '@/lib/profile-insights/types'
import { requireUser } from '@/lib/session'
import { AccountIdSchema, parseSetupPayload } from '@/lib/setup-payloads'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'

/**
 * What each of an identity's profile links shows about how it posts on that
 * platform (src/lib/profile-insights): read, refreshed and edited from the
 * Profile page. An analysis starts on its own when a link is added or
 * changed (./actions.ts); Refresh starts one again.
 */

type Result<T> = ({ success: true } & T) | { success: false; error: string }

const failure = (error: unknown, fallback: string) => ({
  success: false as const,
  error: error instanceof Error ? error.message : fallback
})

function platformOf(value: unknown): PlatformId {
  if (!isPlatformId(value)) throw new Error('Unknown platform.')
  return value
}

/** The identity's analyses as they stand, for the Profile page to follow one running. */
export async function getProfileInsights(
  rawAccountId: string
): Promise<Result<{ views: ProfileInsightView[] }>> {
  const user = await requireUser()
  try {
    const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
    await requireOwnedAccount(user.id, accountId)
    return { success: true, views: await profileInsightViews(accountId) }
  } catch (error) {
    return failure(error, 'The analyses could not be read.')
  }
}

/**
 * Reads the profile's public posts again and makes new insights from them,
 * after the response; the views come back with it 'analyzing'. Edits made
 * to the insights are replaced once it succeeds.
 */
export async function refreshProfileInsights(
  rawAccountId: string,
  rawPlatform: string
): Promise<Result<{ views: ProfileInsightView[] }>> {
  // Signed-in only: every analysis is a paid model call.
  const user = await requireUser()
  try {
    const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
    await requireOwnedAccount(user.id, accountId)
    const started = await startProfileAnalysis(
      accountId,
      platformOf(rawPlatform)
    )
    if ('error' in started) return { success: false, error: started.error }
    after(() => runProfileAnalysis(started.claim))
    return { success: true, views: await profileInsightViews(accountId) }
  } catch (error) {
    return failure(error, 'The analysis could not be started.')
  }
}

/**
 * Saves the user's own version of a platform's insights. Allowed whenever
 * the profile has an analysis row, including one that found too little to
 * analyze: the user can describe their style there by hand.
 */
export async function saveProfileInsights(
  rawAccountId: string,
  rawPlatform: string,
  rawInsights: unknown
): Promise<Result<{ views: ProfileInsightView[] }>> {
  const user = await requireUser()
  try {
    const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
    await requireOwnedAccount(user.id, accountId)
    const platform = platformOf(rawPlatform)
    const insights = cleanProfileInsights(rawInsights)
    if (!insights)
      return { success: false, error: 'Fill in at least one field.' }

    const t = platformInsightsTable
    const where = and(eq(t.accountId, accountId), eq(t.platform, platform))
    const [row] = await db
      .select({ status: t.status, startedAt: t.startedAt })
      .from(t)
      .where(where)
    if (!row) return { success: false, error: 'Add this profile link first.' }
    // A running analysis would overwrite the edit when it finishes.
    if (effectiveStatus(row) === 'analyzing') {
      return {
        success: false,
        error: 'This profile is being analyzed. Edit it once that finishes.'
      }
    }
    const now = new Date()
    await db
      .update(t)
      .set({
        insights,
        editedAt: now,
        status: 'ready',
        error: null,
        updatedAt: now
      })
      .where(where)
    revalidatePath(IDENTITY_PATH)
    return { success: true, views: await profileInsightViews(accountId) }
  } catch (error) {
    return failure(error, 'Your changes could not be saved.')
  }
}
