'use server'

import { db } from '@/db'
import { linkedinConnectionsTable } from '@/db/schema'
import { disconnect } from '@/lib/linkedin/connection'
import { isValidTimeZone, parseTimeOfDay } from '@/lib/schedule-time'
import { requireUser } from '@/lib/session'
import { LINKEDIN_SETTINGS_PATH } from '@/lib/settings-path'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

/**
 * Disconnects the signed-in user's LinkedIn publishing connection. Their
 * sign-in (Google or LinkedIn) is untouched.
 *
 * revalidatePath in a Server Action re-renders the page it was called from,
 * layout included (the header's LinkedIn status), in the same response, and
 * the browser drops its copies of other pages: no router.refresh needed.
 */
export async function disconnectLinkedIn() {
  const user = await requireUser()
  try {
    const result = await disconnect(db, user.id)
    if (!result)
      return { success: false as const, error: 'LinkedIn is not connected.' }
    revalidatePath(LINKEDIN_SETTINGS_PATH)
    return { success: true as const, cancelled: result.cancelled }
  } catch (err) {
    console.error(`Could not disconnect LinkedIn for user ${user.id}:`, err)
    return {
      success: false as const,
      error: 'LinkedIn could not be disconnected. Please try again.'
    }
  }
}

const AutoPublishSchema = z.object({
  enabled: z.boolean(),
  time: z
    .string()
    .refine(v => parseTimeOfDay(v) !== null, 'Pick a valid time.'),
  timezone: z.string().refine(isValidTimeZone, 'Pick a valid time zone.')
})

/**
 * Turns auto-publishing on or off, and sets its time. Every save restarts
 * the clock (autoPublishEnabledAt): a slot that already passed today is not
 * published, so turning it on, or moving the time earlier, never publishes
 * anything at once.
 */
export async function saveAutoPublish(input: {
  enabled: boolean
  time: string
  timezone: string
}) {
  const user = await requireUser()
  try {
    const parsed = AutoPublishSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues[0]?.message ?? 'Invalid settings.'
      }
    }
    const { enabled, time, timezone } = parsed.data
    const now = new Date()
    const [row] = await db
      .update(linkedinConnectionsTable)
      .set({
        autoPublish: enabled,
        autoPublishTime: time,
        autoPublishTimezone: timezone,
        autoPublishEnabledAt: enabled ? now : null,
        updatedAt: now
      })
      .where(
        and(
          eq(linkedinConnectionsTable.userId, user.id),
          // Only a working connection can be set to publish by itself.
          enabled ? eq(linkedinConnectionsTable.status, 'connected') : undefined
        )
      )
      .returning({ id: linkedinConnectionsTable.id })
    if (!row) {
      return { success: false as const, error: 'Connect LinkedIn first.' }
    }
    revalidatePath(LINKEDIN_SETTINGS_PATH)
    return { success: true as const }
  } catch (err) {
    console.error(`Could not save auto-publishing for user ${user.id}:`, err)
    return {
      success: false as const,
      error: 'The setting could not be saved. Please try again.'
    }
  }
}
