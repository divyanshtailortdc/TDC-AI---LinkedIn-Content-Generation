import 'server-only'

import { db } from '@/db'
import { preferencesTable } from '@/db/schema'
import { resolveChannels, type ResolvedChannels } from '@/lib/formats'
import { eq } from 'drizzle-orm'

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
