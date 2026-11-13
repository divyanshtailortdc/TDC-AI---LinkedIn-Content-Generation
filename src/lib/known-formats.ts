import { postDraftsTable } from '@/db/schema'
import { FORMAT_IDS } from '@/lib/formats'
import { inArray } from 'drizzle-orm'

/**
 * Drafts in a format the app still has. A removed format (TikTok videos)
 * leaves its drafts in the database, unshown: read as any known format, a
 * TikTok script would pass for a LinkedIn post (formatOf falls back to
 * LinkedIn), and could be approved and published as one.
 */
export const inKnownFormat = () => inArray(postDraftsTable.formatId, [...FORMAT_IDS])
