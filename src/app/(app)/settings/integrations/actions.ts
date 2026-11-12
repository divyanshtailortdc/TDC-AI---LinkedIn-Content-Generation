'use server'

import { db } from '@/db'
import { platformConnectionsTable } from '@/db/schema'
import { getPlatform } from '@/lib/platforms'
import type { BufferChannel } from '@/lib/publishing/buffer/api'
import { API_KEY_SCOPES } from '@/lib/publishing/buffer/oauth'
import { listPlatformChannels } from '@/lib/publishing/buffer/provider'
import { bufferConfig } from '@/lib/publishing/config'
import {
  assertCanPublish,
  changeAccount,
  ConnectionError,
  disconnect,
  getConnection,
  saveConnection,
  usableAccessToken
} from '@/lib/publishing/connection'
import { PlatformApiError } from '@/lib/publishing/errors'
import {
  type BufferPlatformId,
  canPublishTo,
  isBufferPlatform,
  PUBLISHING_PLATFORM_IDS
} from '@/lib/publishing/platform'
import { isValidTimeZone, parseTimeOfDay } from '@/lib/schedule-time'
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
    const result = await disconnect(db, user.id, platform)
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
          eq(platformConnectionsTable.userId, user.id),
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

const BufferKeySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(10, 'Paste the whole Buffer API key.')
    .max(500, 'That does not look like a Buffer API key.')
    .regex(/^\S+$/, 'A Buffer API key has no spaces.'),
  channelId: z.string().trim().min(1).max(200).optional()
})

type ChannelChoice = Pick<BufferChannel, 'id' | 'name' | 'avatar'>

/**
 * Connects X, Facebook or Instagram through Buffer: checks the pasted Buffer
 * API key by listing that network's channels its account can post to, and
 * saves it (encrypted) with the one chosen. With more than one channel and
 * none chosen yet, returns them to pick from. The key is never sent back to
 * the browser.
 */
export async function connectWithBuffer(
  platform: string,
  input: {
    apiKey: string
    channelId?: string
  }
): Promise<
  | { success: true; name: string }
  | { success: false; error: string; channels?: ChannelChoice[] }
> {
  const user = await requireUser()
  if (!isBufferPlatform(platform)) {
    return { success: false, error: 'Unknown platform.' }
  }
  const platformName = getPlatform(platform).name
  try {
    const config = bufferConfig(platform)
    if (!config) {
      return {
        success: false,
        error: `Publishing to ${platformName} is not set up on this server.`
      }
    }
    const parsed = BufferKeySchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? 'Check the API key.'
      }
    }
    const { apiKey, channelId } = parsed.data

    let channels: BufferChannel[]
    try {
      channels = await listPlatformChannels(
        { apiKey, apiUrl: config.apiUrl },
        platform
      )
    } catch (err) {
      if (err instanceof PlatformApiError) {
        return {
          success: false,
          error:
            err.code === 'reauth_required' || err.code === 'missing_permission'
              ? 'Buffer did not accept this API key. Create one in Buffer (Settings → API) and paste it again.'
              : err.retryable
                ? 'Buffer could not be reached. Try again in a moment.'
                : err.message
        }
      }
      throw err
    }

    const usable = channels.filter(c => !c.isLocked)
    if (usable.length === 0) {
      return {
        success: false,
        error:
          channels.length > 0
            ? `Your ${platformName} channel is locked in Buffer (the free plan allows 3 channels). Unlock it in Buffer, then try again.`
            : `No ${platformName} account is connected in this Buffer account. In Buffer, connect your ${platformName} account as a channel, then try again.`
      }
    }
    const channel = channelId
      ? usable.find(c => c.id === channelId)
      : usable.length === 1
        ? usable[0]
        : undefined
    if (!channel) {
      return {
        success: false,
        error: channelId
          ? `That ${platformName} account is no longer in Buffer. Pick another.`
          : `Pick the ${platformName} account to publish to.`,
        channels: usable.map(({ id, name, avatar }) => ({ id, name, avatar }))
      }
    }

    await saveConnection(
      db,
      config,
      user.id,
      {
        accessToken: apiKey,
        // An API key does not run out; Buffer refusing it marks it expired.
        accessTokenExpiresAt: null,
        refreshToken: null,
        refreshTokenExpiresAt: null,
        scopes: API_KEY_SCOPES
      },
      { memberId: channel.id, name: channel.name, pictureUrl: channel.avatar },
      { platform }
    )
    revalidatePath(INTEGRATIONS_SETTINGS_PATH)
    return { success: true, name: channel.name }
  } catch (err) {
    console.error(
      `Could not connect ${platformName} through Buffer for user ${user.id}:`,
      err
    )
    return {
      success: false,
      error: `${platformName} could not be connected. Please try again.`
    }
  }
}

/**
 * The accounts of `platform` in the user's own Buffer account, through their
 * connection.
 */
async function bufferChannelsOf(userId: string, platform: BufferPlatformId) {
  const config = bufferConfig(platform)
  if (!config) {
    throw new ConnectionError(
      `Publishing to ${getPlatform(platform).name} is not set up on this server.`,
      'not_connected'
    )
  }
  const connection = await getConnection(db, userId, platform)
  assertCanPublish(connection, platform)
  const accessToken = await usableAccessToken(db, config, connection)
  const channels = await listPlatformChannels(
    { apiKey: accessToken, apiUrl: config.apiUrl },
    platform
  )
  return { connection, channels: channels.filter(c => !c.isLocked) }
}

const failureMessage = (err: unknown) =>
  err instanceof ConnectionError || err instanceof PlatformApiError
    ? err.message
    : 'Buffer could not be reached. Please try again.'

/** The accounts of `platform` the user can publish as, from their Buffer account. */
export async function listBufferAccounts(platform: string): Promise<
  | { success: true; channels: ChannelChoice[]; currentId: string }
  | { success: false; error: string }
> {
  const user = await requireUser()
  if (!isBufferPlatform(platform)) {
    return { success: false, error: 'Unknown platform.' }
  }
  try {
    const { connection, channels } = await bufferChannelsOf(user.id, platform)
    return {
      success: true,
      channels: channels.map(({ id, name, avatar }) => ({ id, name, avatar })),
      currentId: connection.memberId
    }
  } catch (err) {
    if (!(err instanceof ConnectionError || err instanceof PlatformApiError)) {
      console.error(
        `Could not list ${getPlatform(platform).name} accounts for user ${user.id}:`,
        err
      )
    }
    return { success: false, error: failureMessage(err) }
  }
}

/**
 * Publishes as another account of `platform` in the user's Buffer account.
 * Only an account Buffer lists for them now can be chosen; switching cancels
 * that platform's scheduled posts, as connecting a different account does.
 */
export async function switchBufferAccount(platform: string, channelId: string) {
  const user = await requireUser()
  if (!isBufferPlatform(platform)) {
    return { success: false as const, error: 'Unknown platform.' }
  }
  const platformName = getPlatform(platform).name
  try {
    if (typeof channelId !== 'string' || !channelId) {
      return {
        success: false as const,
        error: `Pick the ${platformName} account to publish as.`
      }
    }
    const { channels } = await bufferChannelsOf(user.id, platform)
    const channel = channels.find(c => c.id === channelId)
    if (!channel) {
      return {
        success: false as const,
        error: `That ${platformName} account is no longer in your Buffer account.`
      }
    }
    const row = await changeAccount(db, user.id, platform, {
      memberId: channel.id,
      name: channel.name,
      pictureUrl: channel.avatar
    })
    if (!row) {
      return { success: false as const, error: `Connect ${platformName} first.` }
    }
    revalidatePath(INTEGRATIONS_SETTINGS_PATH)
    return { success: true as const, name: channel.name }
  } catch (err) {
    if (!(err instanceof ConnectionError || err instanceof PlatformApiError)) {
      console.error(
        `Could not switch the ${platformName} account of user ${user.id}:`,
        err
      )
    }
    return { success: false as const, error: failureMessage(err) }
  }
}
