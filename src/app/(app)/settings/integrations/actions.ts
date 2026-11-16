'use server'

import { db } from '@/db'
import { platformConnectionsTable } from '@/db/schema'
import { getPlatform } from '@/lib/platforms'
import {
  disconnectBuffer,
  linkBufferChannel,
  syncBufferChannels
} from '@/lib/publishing/buffer/connection'
import {
  anyBufferConfig,
  enabledBufferPlatforms
} from '@/lib/publishing/config'
import { ConnectionError, disconnect } from '@/lib/publishing/connection'
import { PlatformApiError } from '@/lib/publishing/errors'
import {
  canPublishTo,
  isBufferPlatform,
  PUBLISHING_PLATFORM_IDS
} from '@/lib/publishing/platform'
import { isValidTimeZone, parseTimeOfDay } from '@/lib/schedule-time'
import { getIdentity, requireIdentityId } from '@/lib/identity'
import { requireUser } from '@/lib/session'
import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

/**
 * Disconnects the signed-in user's connection to one platform. Their sign-in
 * and their other platforms are untouched.
 *
 * revalidatePath in a Server Action re-renders the page it was called from,
 * layout included (the publishing status a post's Publish controls read), in
 * the same response, and the browser drops its copies of other pages: no
 * router.refresh needed.
 */
export async function disconnectPlatform(platform: string) {
  const user = await requireUser()
  if (!canPublishTo(platform)) {
    return { success: false as const, error: 'Unknown platform.' }
  }
  const name = getPlatform(platform).name
  try {
    // The active identity's connection; its other identities keep theirs.
    const result = await disconnect(db, await requireIdentityId(), platform)
    if (!result)
      return { success: false as const, error: `${name} is not connected.` }
    revalidatePath(INTEGRATIONS_SETTINGS_PATH)
    return { success: true as const, cancelled: result.cancelled }
  } catch (err) {
    console.error(`Could not disconnect ${name} for user ${user.id}:`, err)
    return {
      success: false as const,
      error: `${name} could not be disconnected. Please try again.`
    }
  }
}

const AutoPublishSchema = z.object({
  platform: z.enum(PUBLISHING_PLATFORM_IDS, 'Unknown platform.'),
  enabled: z.boolean(),
  time: z
    .string()
    .refine(v => parseTimeOfDay(v) !== null, 'Pick a valid time.'),
  timezone: z.string().refine(isValidTimeZone, 'Pick a valid time zone.')
})

/**
 * Turns auto-publishing to one platform on or off, and sets its time. Every
 * save restarts the clock (autoPublishEnabledAt): a slot that already passed
 * today is not published, so turning it on, or moving the time earlier,
 * never publishes anything at once.
 */
export async function saveAutoPublish(input: {
  platform: string
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
    const { platform, enabled, time, timezone } = parsed.data
    const accountId = await requireIdentityId()
    const now = new Date()
    const [row] = await db
      .update(platformConnectionsTable)
      .set({
        autoPublish: enabled,
        autoPublishTime: time,
        autoPublishTimezone: timezone,
        autoPublishEnabledAt: enabled ? now : null,
        updatedAt: now
      })
      .where(
        and(
          eq(platformConnectionsTable.accountId, accountId),
          eq(platformConnectionsTable.platform, platform),
          // Only a working connection can be set to publish by itself.
          enabled ? eq(platformConnectionsTable.status, 'connected') : undefined
        )
      )
      .returning({ id: platformConnectionsTable.id })
    if (!row) {
      return {
        success: false as const,
        error: `Connect ${getPlatform(platform).name} first.`
      }
    }
    revalidatePath(INTEGRATIONS_SETTINGS_PATH)
    return { success: true as const }
  } catch (err) {
    console.error(`Could not save auto-publishing for user ${user.id}:`, err)
    return {
      success: false as const,
      error: 'The setting could not be saved. Please try again.'
    }
  }
}

const failureMessage = (err: unknown) =>
  err instanceof ConnectionError || err instanceof PlatformApiError
    ? err.message
    : 'Buffer could not be reached. Please try again.'

/**
 * Reads the user's Buffer account and channels again (a channel added or
 * removed in Buffer shows up), and sets up networks of the active identity
 * that have none yet. Within 30 s of the last sync it changes nothing.
 */
export async function syncBuffer(): Promise<
  { success: true; synced: boolean } | { success: false; error: string }
> {
  const user = await requireUser()
  try {
    const config = anyBufferConfig()
    if (!config) {
      return { success: false, error: 'Buffer is not set up on this server.' }
    }
    const identity = await getIdentity()
    const result = await syncBufferChannels(
      db,
      config,
      { userId: user.id, identityId: identity?.id ?? null },
      { platforms: enabledBufferPlatforms() }
    )
    revalidatePath(INTEGRATIONS_SETTINGS_PATH)
    return { success: true, synced: result.synced }
  } catch (err) {
    if (!(err instanceof ConnectionError || err instanceof PlatformApiError)) {
      console.error(
        `Could not sync Buffer for user ${user.id}:`,
        err instanceof Error ? err.message : 'unknown error'
      )
    }
    return { success: false, error: failureMessage(err) }
  }
}

/**
 * Publishes `platform` for the active identity as one of the channels in the
 * user's Buffer account. Only a channel synced from their own Buffer account
 * can be chosen; switching cancels that network's scheduled posts.
 */
export async function selectBufferChannel(platform: string, channelId: string) {
  const user = await requireUser()
  if (!isBufferPlatform(platform)) {
    return { success: false as const, error: 'Unknown platform.' }
  }
  const platformName = getPlatform(platform).name
  if (typeof channelId !== 'string' || !channelId || channelId.length > 200) {
    return {
      success: false as const,
      error: `Pick the ${platformName} account to publish as.`
    }
  }
  try {
    const row = await linkBufferChannel(
      db,
      { userId: user.id, identityId: await requireIdentityId() },
      platform,
      channelId
    )
    revalidatePath(INTEGRATIONS_SETTINGS_PATH)
    return { success: true as const, name: row.name ?? platformName }
  } catch (err) {
    if (!(err instanceof ConnectionError)) {
      console.error(
        `Could not pick the ${platformName} channel of user ${user.id}:`,
        err instanceof Error ? err.message : 'unknown error'
      )
    }
    return { success: false as const, error: failureMessage(err) }
  }
}

/**
 * Disconnects the user's Buffer account: its tokens and channels are
 * deleted, and every network publishing through Buffer, for each of the
 * user's identities, stops (scheduled posts cancelled).
 */
export async function disconnectBufferAccount() {
  const user = await requireUser()
  try {
    const result = await disconnectBuffer(db, user.id)
    if (!result) {
      return { success: false as const, error: 'Buffer is not connected.' }
    }
    revalidatePath(INTEGRATIONS_SETTINGS_PATH)
    return { success: true as const, cancelled: result.cancelled }
  } catch (err) {
    console.error(
      `Could not disconnect Buffer for user ${user.id}:`,
      err instanceof Error ? err.message : 'unknown error'
    )
    return {
      success: false as const,
      error: 'Buffer could not be disconnected. Please try again.'
    }
  }
}
