import { db } from '@/db'
import { postDraftsTable, postMediaTable } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { viewableImageUrl } from './image-store'

/**
 * A post image the browser can show: a signed link for a stored image, the
 * value itself otherwise. Null when the media has no image or is not this
 * account's: it is joined to the draft so one account cannot read another's
 * images by id.
 *
 * The review queue loads it only for the open post (see GET /api/media/[id]):
 * shipping every post's image with the page put megabytes into it.
 */
export async function loadMediaImageUrl(
  accountId: string,
  mediaId: string
): Promise<string | null> {
  const [media] = await db
    .select({ imageUrl: postMediaTable.imageUrl })
    .from(postMediaTable)
    .innerJoin(postDraftsTable, eq(postMediaTable.draftId, postDraftsTable.id))
    .where(
      and(eq(postMediaTable.id, mediaId), eq(postDraftsTable.accountId, accountId))
    )
    .limit(1)
  return media?.imageUrl ? viewableImageUrl(media.imageUrl) : null
}
