'use server'

import { db } from '@/db'
import { goalsTable, postDraftsTable, schedulesTable } from '@/db/schema'
import { requireOwnedAccount } from '@/lib/account-guard'
import { isIsoDay } from '@/lib/calendar'
import { requireIdentityId } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import {
  checkSchedulePayload,
  type SchedulePayload
} from '@/lib/schedule-payload'
import { requireUser } from '@/lib/session'
import { AccountIdSchema, parseSetupPayload } from '@/lib/setup-payloads'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { revalidatePath } from 'next/cache'

/**
 * How many ideas a run produces lives in Preferences; this is only when, and
 * for which goals. Saved runs only generate ideas: nothing is written into a
 * post or published by the schedule.
 */
export async function saveSchedule(
  rawAccountId: string,
  payload: SchedulePayload
) {
  const user = await requireUser()
  try {
    const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
    await requireOwnedAccount(user.id, accountId)

    const { daysOfWeek, dayGoals } = checkSchedulePayload(payload)

    // Only this identity's active goals can be scheduled.
    const allIds = Array.from(new Set(Object.values(dayGoals ?? {}).flat()))
    if (allIds.length > 0) {
      const owned = await db
        .select({ id: goalsTable.id })
        .from(goalsTable)
        .where(
          and(
            eq(goalsTable.accountId, accountId),
            eq(goalsTable.isActive, true),
            inArray(goalsTable.id, allIds)
          )
        )
      if (owned.length !== allIds.length) {
        throw new Error('One of the goals is no longer available.')
      }
    }

    const columns = {
      daysOfWeek,
      timeOfDay: payload.timeOfDay,
      enabled: payload.enabled,
      dayGoals,
      // A schedule keeps the zone it was saved with unless the viewer sends one.
      ...(payload.timezone ? { timezone: payload.timezone } : {}),
      // A new plan starts clean; the next attempt reports for itself.
      lastError: null
    }

    // One schedule per identity: a save racing this one updates the same row.
    await db
      .insert(schedulesTable)
      .values({ accountId, ...columns })
      .onConflictDoUpdate({
        target: schedulesTable.accountId,
        set: { ...columns, updatedAt: new Date() }
      })

    revalidatePath('/schedule')
    return { success: true }
  } catch (err: any) {
    // A database error's message is the whole query with its values: it is
    // logged here, and the reviewer gets a plain message instead.
    if (err instanceof DrizzleQueryError) {
      console.error(`Failed to save the schedule of ${rawAccountId}:`, err)
      return {
        success: false,
        error: 'Could not save the schedule. Please try again.'
      }
    }
    return { success: false, error: err.message || 'Failed to save schedule' }
  }
}

/** The identity's post, unless it was rejected: a rejected post is not planned. */
function plannablePost(accountId: string, draftId: string) {
  return and(
    eq(postDraftsTable.id, draftId),
    eq(postDraftsTable.accountId, accountId),
    ne(postDraftsTable.status, 'rejected')
  )
}

function revalidatePlanning() {
  revalidatePath('/schedule')
  revalidatePath('/posts')
}

/**
 * Plans the day a post should go out, or clears it with null. Only a date:
 * nothing is published automatically.
 */
export async function planPost(draftId: string, day: string | null) {
  await requireUser()
  try {
    if (!isUuid(draftId)) throw new Error('Post not found')
    if (day !== null && !isIsoDay(day)) throw new Error('Pick a valid date.')
    const accountId = await requireIdentityId()

    const [planned] = await db
      .update(postDraftsTable)
      .set({ plannedFor: day, updatedAt: new Date() })
      .where(plannablePost(accountId, draftId))
      .returning({ id: postDraftsTable.id })
    // An update that matched nothing is not a plan.
    if (!planned) throw new Error('Post not found')

    revalidatePlanning()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to plan the post' }
  }
}

/**
 * Records that the reviewer published an approved post on LinkedIn, or undoes
 * that. A post with no planned day is placed on `day` (the reviewer's today),
 * so the calendar shows when it went out.
 */
export async function setPostPosted(
  draftId: string,
  posted: boolean,
  day: string
) {
  await requireUser()
  try {
    if (!isUuid(draftId)) throw new Error('Post not found')
    if (!isIsoDay(day)) throw new Error('Pick a valid date.')
    const accountId = await requireIdentityId()

    const [updated] = await db
      .update(postDraftsTable)
      .set(
        posted
          ? {
              postedAt: new Date(),
              plannedFor: sql`coalesce(${postDraftsTable.plannedFor}, ${day}::date)`,
              updatedAt: new Date()
            }
          : { postedAt: null, updatedAt: new Date() }
      )
      .where(
        and(
          eq(postDraftsTable.id, draftId),
          eq(postDraftsTable.accountId, accountId),
          // Only an approved post is ready to go out.
          eq(postDraftsTable.status, 'approved')
        )
      )
      .returning({ id: postDraftsTable.id })
    if (!updated) {
      throw new Error('Only an approved post can be marked as posted.')
    }

    revalidatePlanning()
    return { success: true }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to update the post'
    }
  }
}
