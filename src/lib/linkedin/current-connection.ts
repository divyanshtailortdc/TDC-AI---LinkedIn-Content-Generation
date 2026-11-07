import 'server-only'

import { db } from '@/db'
import { linkedinConnectionsTable, type LinkedinConnection } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { cache } from 'react'
import { toConnectionSummary, type ConnectionSummary } from './connection'

/** The columns toConnectionSummary reads, and never a token. */
const SUMMARY_COLUMNS = {
  status: linkedinConnectionsTable.status,
  name: linkedinConnectionsTable.name,
  pictureUrl: linkedinConnectionsTable.pictureUrl,
  connectedAt: linkedinConnectionsTable.connectedAt,
  accessTokenExpiresAt: linkedinConnectionsTable.accessTokenExpiresAt,
  scopes: linkedinConnectionsTable.scopes,
  lastError: linkedinConnectionsTable.lastError,
  autoPublish: linkedinConnectionsTable.autoPublish,
  autoPublishTime: linkedinConnectionsTable.autoPublishTime,
  autoPublishTimezone: linkedinConnectionsTable.autoPublishTimezone
}

/**
 * The user's publishing connection as the browser may see it, or null. Read
 * once per request: the app layout (for the header) and Settings → LinkedIn
 * both ask for it while rendering the same page.
 */
export const getCurrentConnection = cache(
  async (userId: string): Promise<ConnectionSummary | null> => {
    const [row] = await db
      .select(SUMMARY_COLUMNS)
      .from(linkedinConnectionsTable)
      .where(eq(linkedinConnectionsTable.userId, userId))
      .limit(1)
    // Only the selected columns are read from it.
    return row ? toConnectionSummary(row as LinkedinConnection) : null
  }
)
