import 'server-only'

import { db } from '@/db'
import { platformConnectionsTable, type PlatformConnection } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { cache } from 'react'
import { toConnectionSummary, type ConnectionSummary } from './connection'

/** The columns toConnectionSummary reads, and never a token. */
const SUMMARY_COLUMNS = {
  status: platformConnectionsTable.status,
  name: platformConnectionsTable.name,
  pictureUrl: platformConnectionsTable.pictureUrl,
  connectedAt: platformConnectionsTable.connectedAt,
  accessTokenExpiresAt: platformConnectionsTable.accessTokenExpiresAt,
  scopes: platformConnectionsTable.scopes,
  lastError: platformConnectionsTable.lastError,
  autoPublish: platformConnectionsTable.autoPublish,
  autoPublishTime: platformConnectionsTable.autoPublishTime,
  autoPublishTimezone: platformConnectionsTable.autoPublishTimezone
}

/**
 * The user's publishing connection as the browser may see it, or null. Read
 * once per request: the app layout (for the header) and Settings → Integrations
 * both ask for it while rendering the same page.
 */
export const getCurrentConnection = cache(
  async (userId: string): Promise<ConnectionSummary | null> => {
    const [row] = await db
      .select(SUMMARY_COLUMNS)
      .from(platformConnectionsTable)
      .where(eq(platformConnectionsTable.userId, userId))
      .limit(1)
    // Only the selected columns are read from it.
    return row ? toConnectionSummary(row as PlatformConnection) : null
  }
)
