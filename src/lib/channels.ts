import 'server-only'

import { db } from '@/db'
import { preferencesTable } from '@/db/schema'
import {
  DEFAULT_FORMAT,
  resolveChannels,
  type FormatId,
  type ResolvedChannels
} from '@/lib/formats'
import { eq } from 'drizzle-orm'

/** What a creator writes for until they choose: Instagram posts. */
export const CREATOR_START_FORMATS: FormatId[] = ['instagram.caption']

/**
 * Starts a creator on Instagram instead of LinkedIn: when the identity has no
 * preferences yet, or still drafts LinkedIn alone (the untouched default).
 * Formats someone chose are left as they are.
 */
export async function startCreatorFormats(accountId: string): Promise<void> {
  const [row] = await db
    .select({ id: preferencesTable.id, enabledFormats: preferencesTable.enabledFormats })
    .from(preferencesTable)
    .where(eq(preferencesTable.accountId, accountId))
  if (!row) {
    await db
      .insert(preferencesTable)
      .values({ accountId, enabledFormats: CREATOR_START_FORMATS })
      .onConflictDoNothing()
    return
  }
  const formats = row.enabledFormats ?? []
  if (formats.length === 1 && formats[0] === DEFAULT_FORMAT) {
    await db
      .update(preferencesTable)
      .set({ enabledFormats: CREATOR_START_FORMATS, updatedAt: new Date() })
      .where(eq(preferencesTable.id, row.id))
  }
}

/** The formats an identity drafts and what it said about each platform. */
export async function loadChannels(accountId: string): Promise<ResolvedChannels> {
  const [row] = await db
    .select({
      enabledFormats: preferencesTable.enabledFormats,
      channelSettings: preferencesTable.channelSettings
    })
    .from(preferencesTable)
    .where(eq(preferencesTable.accountId, accountId))
  return resolveChannels(row)
}
