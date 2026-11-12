'use server'

import { db } from '@/db'
import { preferencesTable, samplePostsTable } from '@/db/schema'
import { requireOwnedAccount } from '@/lib/account-guard'
import { analyzeVoiceSamples } from '@/lib/ai/skills/voice-analysis'
import {
  cleanChannelSettings,
  isPerformedWell,
  isPlatformId,
  PLATFORMS,
  RUBRIC_LIMIT,
  samplePlatform,
  splitSamplePosts,
  withoutPerformedWell,
  type ChannelSettings,
  type PlatformId
} from '@/lib/formats'
import { IDENTITY_PATH } from '@/lib/identity'
import { requireUser } from '@/lib/session'
import { AccountIdSchema, parseSetupPayload } from '@/lib/setup-payloads'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

/**
 * How an identity writes on one platform, learned from its own posts there.
 * The posts become that platform's sample posts (drafting shows them as
 * examples once there are two) and the analysis becomes its style, which
 * drafting for that platform follows over the core voice. LinkedIn is
 * written in the core voice, so it has no style of its own here.
 */

/** Fewer posts than this teach a habit, not a style. */
const MIN_LEARN_POSTS = 2
/** More posts than this add cost, not accuracy. */
const MAX_LEARN_POSTS = 12
const MAX_PASTE_CHARS = 50_000

type LearnResult =
  | { success: true; rubric: string; count: number }
  | { success: false; error: string }

function platformOf(value: unknown): PlatformId {
  if (!isPlatformId(value) || value === 'linkedin') {
    throw new Error('Pick a platform other than LinkedIn. LinkedIn uses your Voice.')
  }
  return value
}

/** Writes one platform's learned style (or removes it) and keeps every other setting. */
async function setRubric(
  tx: Pick<typeof db, 'select' | 'update' | 'insert'>,
  accountId: string,
  platform: PlatformId,
  rubric: string | undefined
) {
  const [row] = await tx
    .select({ id: preferencesTable.id, channelSettings: preferencesTable.channelSettings })
    .from(preferencesTable)
    .where(eq(preferencesTable.accountId, accountId))
  const settings: ChannelSettings = cleanChannelSettings(row?.channelSettings)
  const { rubric: _old, ...note } = settings[platform] ?? {}
  const next: ChannelSettings = {
    ...settings,
    [platform]: rubric ? { ...note, rubric } : note
  }
  if (row) {
    await tx
      .update(preferencesTable)
      .set({ channelSettings: next, updatedAt: new Date() })
      .where(eq(preferencesTable.id, row.id))
  } else if (rubric) {
    await tx.insert(preferencesTable).values({ accountId, channelSettings: next })
  }
}

export async function learnPlatformStyle(
  rawAccountId: string,
  rawPlatform: string,
  rawText: string
): Promise<LearnResult> {
  // Signed-in only: every analysis is a paid model call.
  const user = await requireUser()
  try {
    const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
    await requireOwnedAccount(user.id, accountId)
    const platform = platformOf(rawPlatform)
    const label = PLATFORMS[platform].label

    const text = typeof rawText === 'string' ? rawText.slice(0, MAX_PASTE_CHARS) : ''
    const posts = splitSamplePosts(text)
      .slice(0, MAX_LEARN_POSTS)
      .map(post => ({
        content: samplePlatform(withoutPerformedWell(post)).content,
        performedWell: isPerformedWell(post)
      }))
      .filter(post => post.content.length > 20)
    if (posts.length < MIN_LEARN_POSTS) {
      return {
        success: false,
        error: `Paste at least ${MIN_LEARN_POSTS} of your ${label} posts, with a line of --- between them.`
      }
    }

    const analysis = await analyzeVoiceSamples(
      posts.map(p => p.content).join('\n---\n'),
      { platform: label }
    )
    // The offline analyzer only counts things; it cannot describe a style.
    if (analysis.provider !== 'claude') {
      return {
        success: false,
        error: 'The AI could not be reached to learn your style. Please try again in a minute.'
      }
    }
    const rubric = analysis.result.derivedStyleRubric.trim().slice(0, RUBRIC_LIMIT)

    await db.transaction(async tx => {
      // This platform's samples are replaced; every other platform's stay.
      await tx
        .delete(samplePostsTable)
        .where(
          and(
            eq(samplePostsTable.accountId, accountId),
            eq(samplePostsTable.platform, platform)
          )
        )
      await tx.insert(samplePostsTable).values(
        posts.map(post => ({
          accountId,
          platform,
          content: post.content,
          performedWell: post.performedWell,
          isActive: true
        }))
      )
      await setRubric(tx, accountId, platform, rubric)
    })

    revalidatePath(`${IDENTITY_PATH}/preferences`)
    return { success: true, rubric, count: posts.length }
  } catch (error) {
    console.error('Learning a platform style failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Your style could not be learned.'
    }
  }
}

/** Drops a platform's learned style and the posts it was learned from. */
export async function forgetPlatformStyle(
  rawAccountId: string,
  rawPlatform: string
): Promise<{ success: true } | { success: false; error: string }> {
  const user = await requireUser()
  try {
    const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
    await requireOwnedAccount(user.id, accountId)
    const platform = platformOf(rawPlatform)
    await db.transaction(async tx => {
      await tx
        .delete(samplePostsTable)
        .where(
          and(
            eq(samplePostsTable.accountId, accountId),
            eq(samplePostsTable.platform, platform)
          )
        )
      await setRubric(tx, accountId, platform, undefined)
    })
    revalidatePath(`${IDENTITY_PATH}/preferences`)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Your style could not be removed.'
    }
  }
}
