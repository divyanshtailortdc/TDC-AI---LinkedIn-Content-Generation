import { postDraftsTable } from '@/db/schema'
import { FORMAT_IDS } from '@/lib/formats'
import { isVideoFormat, VIDEO_GENERATION_ENABLED } from '@/lib/video/formats'
import { inArray } from 'drizzle-orm'

/** While videos are switched off, Reels and Shorts are hidden the same way. */
const SHOWN_FORMAT_IDS = VIDEO_GENERATION_ENABLED
  ? FORMAT_IDS
  : FORMAT_IDS.filter(id => !isVideoFormat(id))

/**
 * Drafts in a format the app still has. A removed format (TikTok videos)
 * leaves its drafts in the database, unshown: read as any known format, a
 * TikTok script would pass for a LinkedIn post (formatOf falls back to
 * LinkedIn), and could be approved and published as one.
 */
export const inKnownFormat = () => inArray(postDraftsTable.formatId, [...SHOWN_FORMAT_IDS])
