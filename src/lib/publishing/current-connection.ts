import 'server-only'

import { db } from '@/db'
import { platformConnectionsTable, type PlatformConnection } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { cache } from 'react'
import { toConnectionSummary, type ConnectionSummary } from './connection'

/** The columns toConnectionSummary reads; a token only to say whether there is one. */
const SUMMARY_COLUMNS = {
  platform: platformConnectionsTable.platform,
  status: platformConnectionsTable.status,
  name: platformConnectionsTable.name,
  pictureUrl: platformConnectionsTable.pictureUrl,
  connectedAt: platformConnectionsTable.connectedAt,
  accessTokenExpiresAt: platformConnectionsTable.accessTokenExpiresAt,
  // Only whether there is one is passed on (ConnectionSummary.renews).
  refreshToken: platformConnectionsTable.refreshToken,
  scopes: platformConnectionsTable.scopes,
  lastError: platformConnectionsTable.lastError,
  autoPublish: platformConnectionsTable.autoPublish,
  autoPublishTime: platformConnectionsTable.autoPublishTime,
  autoPublishTimezone: platformConnectionsTable.autoPublishTimezone
}

/**
 * The identity's publishing connections as the browser may see them, one per
 * platform it ever connected. Read once per request: the app layout (for a
 * post's Publish controls) and Settings → Integrations both ask while
 * rendering the same page.
 */
export const getCurrentConnections = cache(
  async (accountId: string): Promise<ConnectionSummary[]> => {
    const rows = await db
      .select(SUMMARY_COLUMNS)
      .from(platformConnectionsTable)
      .where(eq(platformConnectionsTable.accountId, accountId))
    // Only the selected columns are read from them.
    return rows.map(row => toConnectionSummary(row as PlatformConnection))
  }
)
