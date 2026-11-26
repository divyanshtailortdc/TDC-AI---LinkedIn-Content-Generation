import 'server-only'

import { db } from '@/db'
import { postDraftsTable, postVideosTable } from '@/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import {
  downloadableStoredUrl,
  viewableImageUrl
} from '~/lib/media/image-store'
import { UPLOADED_VIDEO_PROVIDER } from '~/lib/video/models'

/** A post's uploaded video, as the post page shows it. */
export interface UploadedVideoView {
  videoUrl: string
  downloadUrl: string
  width: number
  height: number
  durationSeconds: number
  byteSize: number | null
  fileName: string | null
}

/**
 * The video the user uploaded for a post (Create from media), with links to
 * play and download it. Null when the post is not this identity's or has none.
 */
export async function loadUploadedVideo(
  accountId: string,
  draftId: string
): Promise<UploadedVideoView | null> {
  const [video] = await db
    .select({
      videoUrl: postVideosTable.videoUrl,
      width: postVideosTable.width,
      height: postVideosTable.height,
      durationSeconds: postVideosTable.durationSeconds,
      byteSize: postVideosTable.byteSize,
      mediaType: postVideosTable.mediaType,
      metadata: postVideosTable.metadata
    })
    .from(postVideosTable)
    .innerJoin(postDraftsTable, eq(postDraftsTable.id, postVideosTable.draftId))
    .where(
      and(
        eq(postVideosTable.draftId, draftId),
        eq(postDraftsTable.accountId, accountId),
        eq(postVideosTable.provider, UPLOADED_VIDEO_PROVIDER),
        eq(postVideosTable.status, 'ready')
      )
    )
    .orderBy(desc(postVideosTable.version))
    .limit(1)
  if (!video?.videoUrl) return null
  const fileName =
    typeof video.metadata?.fileName === 'string'
      ? video.metadata.fileName
      : null
  const extension = video.mediaType === 'video/quicktime' ? 'mov' : 'mp4'
  return {
    videoUrl: await viewableImageUrl(video.videoUrl),
    downloadUrl: await downloadableStoredUrl(
      video.videoUrl,
      fileName ?? `video.${extension}`
    ),
    width: video.width,
    height: video.height,
    durationSeconds: video.durationSeconds,
    byteSize: video.byteSize,
    fileName
  }
}
