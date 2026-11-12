'use server'

import { db } from '@/db'
import {
  preferencesTable,
  type Guardrails,
  type PostConstraints
} from '@/db/schema'
import { requireOwnedAccount } from '@/lib/account-guard'
import { IDENTITY_PATH } from '@/lib/identity'
import { requireUser } from '@/lib/session'
import {
  cleanChannelSettings,
  cleanFormats,
  isCreatableFormat,
  type ChannelNote,
  type ChannelSettings,
  type FormatId,
  type PlatformId
} from '@/lib/formats'
import {
  AccountIdSchema,
  parseSetupPayload,
  PreferencesPayloadSchema
} from '@/lib/setup-payloads'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

/**
 * Emoji, hashtags and banned words live in Voice, and link placement on each
 * goal beside its link; nothing here repeats them. What to write about comes
 * from the goals picked for each run; content pillars are gone, and saving
 * leaves the pillars an account saved before untouched.
 */
export type PreferencesPayload = {
  ideasPerRun: number
  post_constraints: PostConstraints
  guardrails: Guardrails
  /** The formats drafted and what was said about each platform; absent keeps them. */
  channels?: {
    enabledFormats: string[]
    settings: ChannelSettings
  }
}

const MIN_IDEAS_PER_RUN = 3
const MAX_IDEAS_PER_RUN = 12

function validate(payload: PreferencesPayload) {
  const ideas = Number(payload.ideasPerRun)
  if (
    !Number.isInteger(ideas) ||
    ideas < MIN_IDEAS_PER_RUN ||
    ideas > MAX_IDEAS_PER_RUN
  ) {
    throw new Error(
      `Ideas per run must be between ${MIN_IDEAS_PER_RUN} and ${MAX_IDEAS_PER_RUN}.`
    )
  }
}

/** Known formats that can be created (no Reels); refused when none are left. */
function checkedFormats(values: string[]): FormatId[] {
  const formats = cleanFormats(values).filter(isCreatableFormat)
  if (formats.length === 0) {
    throw new Error('Turn on at least one platform to write posts for.')
  }
  return formats
}

/**
 * The styles learned from each platform's posts are kept: the form never
 * sends them, and only learnPlatformStyle and forgetPlatformStyle change them.
 */
function withLearnedStyles(
  next: ChannelSettings,
  saved: ChannelSettings
): ChannelSettings {
  const out: ChannelSettings = { ...next }
  for (const [platform, note] of Object.entries(saved) as Array<
    [PlatformId, ChannelNote]
  >) {
    if (note.rubric) out[platform] = { ...out[platform], rubric: note.rubric }
  }
  return out
}

export async function savePreferences(
  rawAccountId: string,
  rawPayload: PreferencesPayload
) {
  const user = await requireUser()
  const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
  await requireOwnedAccount(user.id, accountId)
  const payload = parseSetupPayload(PreferencesPayloadSchema, rawPayload)
  validate(payload)

  const existing = await db
    .select({
      id: preferencesTable.id,
      channelSettings: preferencesTable.channelSettings
    })
    .from(preferencesTable)
    .where(eq(preferencesTable.accountId, accountId))

  const columns = {
    ideasPerRun: Number(payload.ideasPerRun),
    postConstraints: {
      cta_required: Boolean(payload.post_constraints.cta_required)
    },
    guardrails: {
      // Trimmed, blank ones dropped, and repeats (in any case) kept once,
      // spelled the way they were first entered.
      banned_topics: payload.guardrails.banned_topics
        .map(t => t.trim())
        .filter(
          (t, i, all) =>
            t && all.findIndex(o => o.toLowerCase() === t.toLowerCase()) === i
        ),
      compliance_notes: payload.guardrails.compliance_notes.trim()
    },
    ...(payload.channels
      ? {
          enabledFormats: checkedFormats(payload.channels.enabledFormats),
          channelSettings: withLearnedStyles(
            cleanChannelSettings(payload.channels.settings),
            cleanChannelSettings(existing[0]?.channelSettings)
          )
        }
      : {}),
    updatedAt: new Date()
  }

  if (existing.length > 0) {
    await db
      .update(preferencesTable)
      .set(columns)
      .where(eq(preferencesTable.accountId, accountId))
  } else {
    await db.insert(preferencesTable).values({ accountId, ...columns })
  }

  revalidatePath(`${IDENTITY_PATH}/preferences`)
  revalidatePath(IDENTITY_PATH)
  revalidatePath('/')
  return { success: true }
}
