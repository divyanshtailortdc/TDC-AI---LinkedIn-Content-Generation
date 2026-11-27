import 'server-only'

import { db } from '@/db'
import { postDraftsTable, postMediaTable, postVideosTable } from '@/db/schema'
import {
  DEFAULT_FORMAT,
  formatCharCount,
  FORMATS,
  type FormatId
} from '@/lib/formats'
import type { PlatformId } from '@/lib/platforms'
import { postCharCount } from '@/lib/post-text'
import { readBodyCapped, safeFetch, UnsafeUrlError } from '@/lib/safe-url'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebStream } from 'node:stream/web'
import { loadGenerationContext } from '~/lib/ai/context'
import { writeMediaPosts, type MediaAnalysis } from '~/lib/ai/skills/media-post'
import { withAiSpend } from '~/lib/ai/spend'
import {
  canStoreUploads,
  copyStoredFileToDraft,
  createUploadTarget,
  deleteStoredImages,
  loadStoredBytes,
  openStoredFile,
  statStoredFile,
  storeUpload,
  uploadIdOf,
  uploadValueOf
} from '~/lib/media/image-store'
import { REVIEWER_UPLOAD_SOURCE } from '~/lib/media/media-source'
import {
  UPLOADED_VIDEO_MODEL_ID,
  UPLOADED_VIDEO_PROVIDER
} from '~/lib/video/models'
import { draftColumnsOf, type MediaPostDraft } from './drafts'
import { storedAnalysisFields } from './stored-analysis'
import { inspectImage, inspectVideo, UnreadableMediaError } from './inspect'
import {
  aspectRatioOf,
  UPLOAD_IMAGE_MIN_EDGE,
  UPLOAD_MAX_BYTES,
  uploadFormatOf,
  uploadTypeByExtension,
  uploadTypeOf,
  validateUploadFile,
  videoWarning,
  type UploadKind
} from './rules'

/**
 * Create from media, on the server (see ./rules): the file goes straight to
 * the bucket under the identity's uploads, the AI looks at it and writes a
 * post per platform, and posts are made from what the user kept, each with
 * its own copy of the original file as its image or video.
 */

/** A problem the user can fix: shown as it is. */
export class MediaUploadError extends Error {}

const NO_STORAGE =
  'Uploading media needs file storage, which is not set up on this server (STORAGE_BUCKET).'

/**
 * An uploaded video, downloaded to a temporary file for ffmpeg: the bundled
 * ffmpeg cannot open links (see inspectVideo). The caller removes it.
 */
async function downloadToTemp(
  value: string,
  signal?: AbortSignal
): Promise<{ file: string; remove: () => Promise<void> }> {
  const file = path.join(
    tmpdir(),
    `media-upload-${randomUUID()}${path.extname(value)}`
  )
  const remove = () => rm(file, { force: true })
  try {
    const stored = await openStoredFile(value)
    await pipeline(
      Readable.fromWeb(stored.body as NodeWebStream),
      createWriteStream(file),
      { signal }
    )
  } catch (err) {
    await remove()
    throw err
  }
  return { file, remove }
}

export interface UploadSummary {
  uploadId: string
  kind: UploadKind
  mediaType: string
  byteSize: number
  fileName: string | null
}

const cleanFileName = (name: string | null | undefined) =>
  name
    ?.replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 200) || null

/** A place in the bucket for the browser to put a file, and the link to PUT it to. */
export async function startUpload(
  accountId: string,
  file: { mediaType: string; size: number; fileName?: string | null }
): Promise<UploadSummary & { uploadUrl: string }> {
  if (!canStoreUploads()) throw new MediaUploadError(NO_STORAGE)
  const problem = validateUploadFile({ type: file.mediaType, size: file.size })
  if (problem) throw new MediaUploadError(problem)
  const type = uploadTypeOf(file.mediaType)!
  const target = await createUploadTarget(accountId, type)
  return {
    uploadId: uploadIdOf(target.value),
    kind: type.kind,
    mediaType: type.mediaType,
    byteSize: file.size,
    fileName: cleanFileName(file.fileName),
    uploadUrl: target.uploadUrl
  }
}

/**
 * Fetches media someone shared as a link and keeps it as an upload. Only a
 * public address is fetched (safeFetch), and no more than the size cap.
 */
export async function uploadFromLink(
  accountId: string,
  link: string
): Promise<UploadSummary> {
  if (!canStoreUploads()) throw new MediaUploadError(NO_STORAGE)
  let response: Response
  try {
    response = await safeFetch(link, {
      signal: AbortSignal.timeout(60_000),
      headers: { Accept: 'image/*,video/*' }
    })
  } catch (err) {
    throw new MediaUploadError(
      err instanceof UnsafeUrlError
        ? 'That link cannot be opened from here. Use a public http(s) link.'
        : 'That link could not be opened. Check it, or download the file and upload it.'
    )
  }
  if (!response.ok) {
    throw new MediaUploadError(
      `That link answered ${response.status}. Check it, or upload the file.`
    )
  }
  const declared = (response.headers.get('content-type') ?? '')
    .split(';')[0]!
    .trim()
  const type = uploadTypeOf(declared)
  if (!type) {
    throw new MediaUploadError(
      'That link is not a JPEG, PNG or WebP image or an MP4 or MOV video. Link straight to the file, or upload it.'
    )
  }
  const max = UPLOAD_MAX_BYTES[type.kind]
  const { bytes, truncated } = await readBodyCapped(response, max)
  const problem = validateUploadFile({
    type: type.mediaType,
    size: truncated ? max + 1 : bytes.length
  })
  if (problem) throw new MediaUploadError(problem)
  const value = await storeUpload(accountId, {
    buffer: Buffer.from(bytes),
    mediaType: type.mediaType,
    extension: type.extension
  })
  const path = (() => {
    try {
      return decodeURIComponent(new URL(link).pathname.split('/').pop() ?? '')
    } catch {
      return ''
    }
  })()
  return {
    uploadId: uploadIdOf(value),
    kind: type.kind,
    mediaType: type.mediaType,
    byteSize: bytes.length,
    fileName: cleanFileName(path)
  }
}

/** An upload of this identity's, as stored: refused when missing, of a wrong type or too big. */
async function loadUpload(accountId: string, uploadId: string) {
  const value = uploadValueOf(accountId, uploadId)
  if (!value)
    throw new MediaUploadError(
      'That upload was not found. Upload the file again.'
    )
  const extension = uploadId.slice(uploadId.lastIndexOf('.') + 1)
  const stat = await statStoredFile(value)
  if (!stat)
    throw new MediaUploadError(
      'That upload was not found. Upload the file again.'
    )
  // The extension was set from the type the upload link was signed for,
  // which the bucket refuses any other type under.
  const type = uploadTypeByExtension(extension)
  if (!type) {
    throw new MediaUploadError(
      'That file type cannot be posted. Upload a JPEG, PNG, WebP, MP4 or MOV file.'
    )
  }
  const problem = validateUploadFile({
    type: type.mediaType,
    size: stat.byteSize
  })
  if (problem) throw new MediaUploadError(problem)
  return { value, ...type, byteSize: stat.byteSize }
}

/** What is known about an uploaded file, shown with the posts. */
export interface UploadFacts {
  kind: UploadKind
  width: number | null
  height: number | null
  durationSeconds: number | null
  byteSize: number
}

export interface AnalyzeResult {
  media: UploadFacts
  analysis: MediaAnalysis
  posts: MediaPostDraft[]
  /** Why the video may not suit a platform, by platform. */
  warnings: Partial<Record<PlatformId, string>>
}

/** The formats to write for: each platform asked for that takes this kind of media. */
function targetsFor(kind: UploadKind, platforms: readonly PlatformId[]) {
  return platforms
    .map(platform => ({ platform, formatId: uploadFormatOf(kind, platform) }))
    .filter(
      (t): t is { platform: PlatformId; formatId: FormatId } =>
        t.formatId !== null
    )
}

/**
 * The AI looks at the upload and writes a post per platform. Charged to the
 * identity's post editing. Throws MediaUploadError for a file it cannot read.
 */
export async function analyzeUpload(
  accountId: string,
  input: { uploadId: string; platforms: PlatformId[]; notes: string },
  abortSignal?: AbortSignal
): Promise<AnalyzeResult> {
  const upload = await loadUpload(accountId, input.uploadId)
  const targets = targetsFor(upload.kind, input.platforms)
  if (targets.length === 0) {
    throw new MediaUploadError(
      upload.kind === 'video'
        ? 'Pick at least one platform that takes videos.'
        : 'Pick at least one platform that takes images.'
    )
  }

  let facts: UploadFacts
  let pictures
  let frameTimes: number[] | undefined
  let hasAudio = false
  if (upload.kind === 'image') {
    const image = await inspectImage(await loadStoredBytes(upload.value))
    if (!image)
      throw new MediaUploadError(
        'The image could not be read. The file may be corrupt.'
      )
    if (Math.min(image.width, image.height) < UPLOAD_IMAGE_MIN_EDGE) {
      throw new MediaUploadError(
        `The image is too small (${image.width}×${image.height}). Use one at least ${UPLOAD_IMAGE_MIN_EDGE}px on each side.`
      )
    }
    facts = {
      kind: 'image',
      width: image.width,
      height: image.height,
      durationSeconds: null,
      byteSize: upload.byteSize
    }
    pictures = [image.picture]
  } else {
    const download = await downloadToTemp(upload.value, abortSignal)
    try {
      const video = await inspectVideo(download.file, abortSignal)
      facts = {
        kind: 'video',
        width: video.width,
        height: video.height,
        durationSeconds: video.durationSeconds,
        byteSize: upload.byteSize
      }
      pictures = video.frames.map(f => f.picture)
      frameTimes = video.frames.map(f => f.atSeconds)
      hasAudio = video.hasAudio
    } catch (err) {
      if (err instanceof UnreadableMediaError)
        throw new MediaUploadError(err.message)
      throw err
    } finally {
      await download.remove()
    }
  }

  const ctx = await loadGenerationContext(accountId)
  const result = await withAiSpend({ source: 'posts', accountId }, () =>
    writeMediaPosts({
      ctx,
      media: {
        kind: facts.kind,
        width: facts.width,
        height: facts.height,
        durationSeconds: facts.durationSeconds,
        hasAudio,
        frameTimes
      },
      pictures,
      targets,
      notes: input.notes,
      abortSignal
    })
  )

  const warnings: AnalyzeResult['warnings'] = {}
  if (facts.kind === 'video') {
    for (const { platform } of targets) {
      const warning = videoWarning(platform, facts)
      if (warning) warnings[platform] = warning
    }
  }
  return {
    media: facts,
    analysis: result.analysis,
    posts: result.posts,
    warnings
  }
}

export interface CreatedMediaPost {
  platform: PlatformId
  draftId: string
}

/**
 * Makes the posts: one per draft, each with its own copy of the uploaded
 * file as its image (post_media) or its video (post_videos), approved when
 * the user is publishing or scheduling them now. The upload itself is
 * deleted once every post has its copy.
 */
export async function createPostsFromUpload(
  accountId: string,
  input: {
    uploadId: string
    fileName: string | null
    summary: string
    /** What the AI saw in the media, kept for Regenerate; null when not sent. */
    analysis?: MediaAnalysis | null
    /** The author's notes, kept for Regenerate. */
    notes?: string
    posts: MediaPostDraft[]
    approved: boolean
    /**
     * The size and length the look at it found (analyzeUpload), as the
     * browser sends them back: shown with the post, never used to publish
     * it, so they are not read again (that would deploy ffmpeg with the page).
     */
    media: {
      width: number | null
      height: number | null
      durationSeconds: number | null
    }
  }
): Promise<CreatedMediaPost[]> {
  const upload = await loadUpload(accountId, input.uploadId)
  const size = (n: number | null) =>
    n !== null && Number.isFinite(n) && n > 0
      ? Math.min(Math.round(n), 100_000)
      : null
  const width = size(input.media.width)
  const height = size(input.media.height)
  const image = upload.kind === 'image' ? { width, height } : null
  const video =
    upload.kind === 'video'
      ? { width, height, durationSeconds: size(input.media.durationSeconds) }
      : null

  const created: CreatedMediaPost[] = []
  const now = new Date()
  for (const post of input.posts) {
    const formatId = uploadFormatOf(upload.kind, post.platform)
    if (!formatId) continue
    const draft = { ...post, formatId }
    const columns = draftColumnsOf(draft)
    const isScript = FORMATS[formatId].structure === 'script'
    const draftId = randomUUID()
    const fileUrl = await copyStoredFileToDraft(upload.value, draftId, upload)
    const text = {
      hook: columns.hook,
      body: columns.body,
      cta: columns.cta,
      hashtags: columns.hashtags,
      payload: columns.payload
    }
    try {
      await db.transaction(async tx => {
        await tx.insert(postDraftsTable).values({
          id: draftId,
          accountId,
          platform: post.platform,
          formatId,
          formatVersion: FORMATS[formatId].version,
          hook: columns.hook,
          body: columns.body,
          originalHook: columns.hook,
          originalBody: columns.body,
          cta: columns.cta,
          firstComment: columns.firstComment,
          hashtags: columns.hashtags,
          charCount:
            formatId === DEFAULT_FORMAT
              ? postCharCount(text)
              : formatCharCount(formatId, text),
          payload: {
            ...columns.payload,
            upload: {
              kind: upload.kind,
              fileName: input.fileName,
              summary: input.summary.slice(0, 1000),
              ...storedAnalysisFields({
                analysis: input.analysis ?? null,
                notes: input.notes ?? ''
              })
            }
          },
          // A Short is a video by its format; every other post says so.
          mediaFormat:
            upload.kind === 'image' ? 'image' : isScript ? null : 'video',
          status: input.approved ? 'approved' : 'draft',
          approvedAt: input.approved ? now : null
        })
        if (image) {
          await tx.insert(postMediaTable).values({
            draftId,
            version: 1,
            status: 'active',
            mode: 'upload',
            imageUrl: fileUrl,
            altText: draft.altText.trim() || null,
            metadata: {
              source: REVIEWER_UPLOAD_SOURCE,
              fallbackApplied: false,
              width: image.width,
              height: image.height,
              fileName: input.fileName
            }
          })
        }
        if (video) {
          await tx.insert(postVideosTable).values({
            draftId,
            version: 1,
            status: 'ready',
            provider: UPLOADED_VIDEO_PROVIDER,
            modelId: UPLOADED_VIDEO_MODEL_ID,
            prompt: '',
            aspectRatio:
              video.width && video.height
                ? aspectRatioOf(video.width, video.height)
                : 'unknown',
            width: video.width ?? 0,
            height: video.height ?? 0,
            durationSeconds: Math.round(video.durationSeconds ?? 0),
            videoUrl: fileUrl,
            mediaType: upload.mediaType,
            byteSize: upload.byteSize,
            metadata: { source: 'upload', fileName: input.fileName },
            completedAt: now
          })
        }
      })
    } catch (err) {
      await deleteStoredImages([fileUrl])
      throw err
    }
    created.push({ platform: post.platform, draftId })
  }

  if (created.length === input.posts.length)
    await deleteStoredImages([upload.value])
  return created
}
