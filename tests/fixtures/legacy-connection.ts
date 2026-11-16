import { platformConnectionsTable } from '../../src/db/schema'
import type { PublishingDb } from '../../src/lib/publishing/connection'
import type { BufferPlatformId } from '../../src/lib/publishing/platform'
import { encryptToken } from '../../src/lib/publishing/token-crypto'

/**
 * A network connection made the old way, holding its own Buffer API key, as
 * connections from before one Buffer connection per user still do in real
 * databases. The app no longer creates these; tests use them for what it
 * still publishes through, and for moving them onto a Buffer connection.
 * Upserts on (identity, platform), as reconnecting did: working again, with
 * this key and channel.
 */
export async function insertLegacyConnection(
  database: PublishingDb,
  encryptionKey: Buffer,
  owner: { userId: string; accountId: string },
  platform: BufferPlatformId,
  channel: { memberId: string; name: string },
  apiKey: string
) {
  const columns = {
    memberId: channel.memberId,
    name: channel.name,
    pictureUrl: null,
    bufferConnectionId: null,
    accessToken: encryptToken(apiKey, encryptionKey, owner.userId),
    accessTokenExpiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    scopes: ['account:read', 'posts:read', 'posts:write'],
    status: 'connected' as const,
    lastError: null,
    updatedAt: new Date()
  }
  const [row] = await database
    .insert(platformConnectionsTable)
    .values({ userId: owner.userId, accountId: owner.accountId, platform, ...columns })
    .onConflictDoUpdate({
      target: [platformConnectionsTable.accountId, platformConnectionsTable.platform],
      set: columns
    })
    .returning()
  return row!
}
