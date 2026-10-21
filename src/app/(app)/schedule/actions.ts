'use server'

import { db } from '@/db'
import { postDraftsTable, schedulesTable } from '@/db/schema'
import { requireOwnedAccount } from '@/lib/account-guard'
import { isIsoDay } from '@/lib/calendar'
import { requireIdentityId } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import { requireUser } from '@/lib/session'
import { AccountIdSchema, parseSetupPayload } from '@/lib/setup-payloads'
import { and, eq, ne, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

/** How many ideas a run produces lives in Preferences; this is only when. */
export async function saveSchedule(
  rawAccountId: string,
  payload: {
    daysOfWeek: number[]
    timeOfDay: string
    enabled: boolean
  }
) {
  const user = await requireUser()
  try {
    const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
    await requireOwnedAccount(user.id, accountId)
    if (payload.daysOfWeek.length === 0) {
      throw new Error('Pick at least one day.')
    }

    const existing = await db.query.schedulesTable.findFirst({
      where: eq(schedulesTable.accountId, accountId)
    })

    const columns = {
      daysOfWeek: payload.daysOfWeek,
      timeOfDay: payload.timeOfDay,
      enabled: payload.enabled
    }

    if (existing) {
      await db
        .update(schedulesTable)
        .set({ ...columns, updatedAt: new Date() })
        .where(eq(schedulesTable.id, existing.id))
    } else {
      await db.insert(schedulesTable).values({ accountId, ...columns })
    }

    revalidatePath('/schedule')
    return { success: true }
  } catch (err: any) {
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
