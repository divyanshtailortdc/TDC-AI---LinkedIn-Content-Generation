import 'server-only'

import { db } from '@/db'
import { postDraftsTable, postVideosTable, type PostVideo } from '@/db/schema'
import { formatOf, isPlatformId } from '@/lib/formats'
import { videoScriptOf } from '@/lib/formats/text'
import { PLATFORMS } from '@/lib/platforms'
import { assertPostChangeable } from '@/lib/publishing/post-lock'
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { after } from 'next/server'
import { env } from '~/env'
import { onVercel } from '~/lib/function-limit'
import { withAiSpend } from '~/lib/ai/spend'
import { isUniqueViolation } from '~/lib/db-errors'
import {
  downloadableStoredUrl,
  storeDraftFile,
  viewableImageUrl
} from '~/lib/media/image-store'
import {
  isVideoFormat,
  videoSpecOf,
  type VideoFormatId,
  type VideoSpec
} from './formats'
import { RECORDER_MODEL_ID, RECORDER_PROVIDER, UPLOADED_VIDEO_PROVIDER } from './models'
import { recorder } from './providers/recorder'
import { findFfmpeg, RendererUnavailableError } from './render/binaries'
import { parsePlan, plannedSeconds, planVideo } from './render/plan'
import { makeSceneImages, type SceneImage } from './scenes'

/**
 * A post's video, started from the post page or by drafting, and recorded
 * with the product-video skill's method (src/lib/video/render): the script
 * is planned into cards and slides when it starts, and recorded on this
 * server after the response that started it, in about a minute. A page poll
 * or the job pass that finds it not yet recorded claims and records it, so
 * one whose function died is recorded again. One runs per post at a time (a
 * unique index, so a double click starts one).
 */

/** A video still not recorded after this is given up on. */
const GENERATION_TIMEOUT_MS = 30 * 60_000
/**
 * A recording claimed this long ago and not finished died with its function
 * (they end at 300 s): another may claim it.
 */
const RENDER_LEASE_MS = 6 * 60_000
/** Recordings of one video started before it is given up on. */
const MAX_RENDER_ATTEMPTS = 3
/** The job pass starts no recording this long in, so it ends in its function's time. */
const RENDER_PASS_BUDGET_MS = 140_000
/**
 * Scene pictures that took longer than this to make leave the recording to
 * the next poll or job pass, so neither runs past its function's 300 s.
 */
const RECORD_AFTER_SCENES_MS = 100_000
/**
 * The job pass starts making a video's pictures only this early in, so the
 * two or three minutes they take end inside its function's time.
 */
const PASS_SCENES_START_MS = 60_000

/**
 * Whether this function can record: on Vercel only the video and job routes
 * carry ffmpeg and the browser (next.config.ts). Elsewhere (drafting) a
 * video is left for them before anything is spent on it.
 */
async function canRecordHere(): Promise<boolean> {
  if (!onVercel()) return true
  try {
    await findFfmpeg()
    return true
  } catch (err) {
    if (err instanceof RendererUnavailableError) return false
    throw err
  }
}

export interface VideoView {
  id: string
  version: number
  status: 'generating' | 'ready' | 'failed'
  startedAt: string
  completedAt: string | null
  error: string | null
  /** To play it: a signed link, for a ready video. */
  videoUrl: string | null
  /** The same file, saved under a name, for Download. */
  downloadUrl: string | null
  /** A recording made in the look of their posts there: "Instagram". */
  lookFrom: string | null
}

export interface VideoState {
  spec: VideoSpec
  /** Why no video can be made now; null when one can. */
  unavailable: string | null
  /** Published or marked posted: no new video. */
  locked: string | null
  /** The script has no spoken words to make a video from. */
  noScript: boolean
  /** The generation under way, if any. */
  running: VideoView | null
  /** The newest finished video, shown while a new one is made. */
  ready: VideoView | null
  /** The newest generation, when it failed after the ready one. */
  failed: VideoView | null
}

export type StartVideoOutcome =
  | { status: 'started'; videoId: string }
  | { status: 'not_found' }
  | { status: 'already_running' }
  | { status: 'unavailable'; error: string }
  | { status: 'failed'; error: string }

type VideoDraft = {
  id: string
  accountId: string
  ideaId: string | null
  formatId: VideoFormatId
  hook: string
  body: string
  cta: string | null
  hashtags: string[] | null
  payload: Record<string, unknown> | null
  postedAt: Date | null
}

/** The draft, when it is this identity's and a video format. */
async function loadVideoDraft(
  accountId: string,
  draftId: string
): Promise<VideoDraft | null> {
  const [draft] = await db
    .select({
      id: postDraftsTable.id,
      accountId: postDraftsTable.accountId,
      ideaId: postDraftsTable.ideaId,
      formatId: postDraftsTable.formatId,
      hook: postDraftsTable.hook,
      body: postDraftsTable.body,
      cta: postDraftsTable.cta,
      hashtags: postDraftsTable.hashtags,
      payload: postDraftsTable.payload,
      postedAt: postDraftsTable.postedAt
    })
    .from(postDraftsTable)
    .where(
      and(
        eq(postDraftsTable.id, draftId),
        eq(postDraftsTable.accountId, accountId)
      )
    )
    .limit(1)
  if (!draft) return null
  const formatId = formatOf(draft.formatId)
  if (!isVideoFormat(formatId)) return null
  return { ...draft, formatId }
}

/**
 * Runs work after the response, where Vercel keeps the function alive for
 * it (`after`); outside a request (the job timers) it simply runs.
 */
function inBackground(task: () => Promise<void>) {
  const run = () =>
    task().catch(err => console.error('Video recording failed:', err))
  try {
    after(run)
  } catch {
    void run()
  }
}

/** Why no video can be made now, or null when one can. */
function unavailableReason(): string | null {
  if (!env.STORAGE_BUCKET) {
    return 'Videos are kept in object storage; set STORAGE_BUCKET to make them.'
  }
  return null
}

async function viewOf(row: PostVideo, fileName: string): Promise<VideoView> {
  const ready = row.status === 'ready' && row.videoUrl
  return {
    id: row.id,
    version: row.version,
    status:
      row.status === 'ready'
        ? 'ready'
        : row.status === 'failed'
          ? 'failed'
          : 'generating',
    startedAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    error: row.error,
    videoUrl: ready ? await viewableImageUrl(row.videoUrl!) : null,
    downloadUrl: ready
      ? await downloadableStoredUrl(row.videoUrl!, fileName)
      : null,
    lookFrom: isPlatformId(row.metadata?.lookFrom)
      ? PLATFORMS[row.metadata.lookFrom].name
      : null
  }
}

/** "five-checks-instagram-reel-v2.mp4". */
function fileNameFor(draft: VideoDraft, version: number): string {
  const slug = draft.hook
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return `${slug || 'video'}-${draft.formatId.replace('.', '-')}-v${version}.mp4`
}

const fail = (id: string, error: string) =>
  db
    .update(postVideosTable)
    .set({
      status: 'failed',
      error,
      completedAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      and(eq(postVideosTable.id, id), eq(postVideosTable.status, 'generating'))
    )

/**
 * Makes a finished video the post's current one: the one before is
 * superseded, in the same transaction.
 */
async function markReady(
  row: PostVideo,
  draftId: string,
  video: {
    videoUrl: string
    mediaType: string
    byteSize: number
    durationSeconds?: number
    metadata: Record<string, unknown>
  }
) {
  await db.transaction(async tx => {
    await tx
      .update(postVideosTable)
      .set({ status: 'superseded', updatedAt: new Date() })
      .where(
        and(
          eq(postVideosTable.draftId, draftId),
          eq(postVideosTable.status, 'ready')
        )
      )
    await tx
      .update(postVideosTable)
      .set({
        status: 'ready',
        videoUrl: video.videoUrl,
        mediaType: video.mediaType,
        byteSize: video.byteSize,
        ...(video.durationSeconds !== undefined
          ? { durationSeconds: video.durationSeconds }
          : {}),
        error: null,
        completedAt: new Date(),
        updatedAt: new Date(),
        metadata: video.metadata
      })
      .where(eq(postVideosTable.id, row.id))
  })
}

/**
 * Records a video on this server, once: the claim (a lease on
 * lastCheckedAt) keeps a page poll and the job pass from recording it
 * twice, and lets another try once a recording's function died. Never
 * throws.
 */
async function record(
  row: PostVideo,
  draft: VideoDraft,
  opts: {
    /** No picture-making starts after this time (the job pass's). */
    startScenesBy?: number
  } = {}
): Promise<void> {
  const now = Date.now()
  if (now - row.createdAt.getTime() > GENERATION_TIMEOUT_MS) {
    await fail(row.id, 'The video took too long to record. Try again.')
    return
  }
  const seen = row.metadata ?? {}
  if (Number(seen.renderAttempts ?? 0) >= MAX_RENDER_ATTEMPTS) {
    await fail(row.id, 'The video could not be recorded. Try again.')
    return
  }
  if (
    !Array.isArray(seen.scenes) &&
    opts.startScenesBy !== undefined &&
    now > opts.startScenesBy
  ) {
    return
  }
  if (!(await canRecordHere())) return
  // The attempt is counted in the database, and the metadata read back from
  // it: another process may have stored the scene pictures since this row
  // was read, and they must not be lost and paid for again
  const [claimed] = await db
    .update(postVideosTable)
    .set({
      lastCheckedAt: new Date(),
      metadata: sql`${postVideosTable.metadata} || jsonb_build_object('renderAttempts', coalesce((${postVideosTable.metadata}->>'renderAttempts')::int, 0) + 1)`,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(postVideosTable.id, row.id),
        eq(postVideosTable.status, 'generating'),
        or(
          isNull(postVideosTable.lastCheckedAt),
          lt(postVideosTable.lastCheckedAt, new Date(now - RENDER_LEASE_MS))
        )
      )
    )
    .returning({ id: postVideosTable.id, metadata: postVideosTable.metadata })
  if (!claimed) return
  const attempts = Number(claimed.metadata.renderAttempts) - 1
  if (attempts >= MAX_RENDER_ATTEMPTS) {
    await fail(row.id, 'The video could not be recorded. Try again.')
    return
  }
  const metadata: Record<string, unknown> = {
    ...claimed.metadata,
    renderAttempts: attempts
  }

  // First, once per video: pictures for the hook and a few lines, made like
  // their posts. Kept in the metadata, so a later attempt records with them
  let metadataNow: Record<string, unknown> = metadata
  if (!Array.isArray(metadata.scenes)) {
    const spend = {
      source: 'posts' as const,
      accountId: draft.accountId,
      draftId: draft.id
    }
    let made: Awaited<ReturnType<typeof makeSceneImages>>
    try {
      made = await withAiSpend(spend, () =>
        makeSceneImages({
          plan: parsePlan(row.prompt),
          draft,
          platform: videoSpecOf(draft.formatId).platform,
          caption: videoScriptOf(draft).caption || draft.hook
        })
      )
    } catch (err) {
      console.warn(`Scene pictures for video ${row.id} failed:`, err)
      made = {
        scenes: [],
        issues: [],
        error: 'The scene pictures could not be made.',
        usage: null
      }
    }
    // Making pictures is not a recording attempt
    metadataNow = {
      ...metadata,
      renderAttempts: attempts,
      scenes: made.scenes,
      sceneIssues: made.issues,
      ...(made.error ? { sceneError: made.error } : {})
    }
    const late = Date.now() - now > RECORD_AFTER_SCENES_MS
    await db
      .update(postVideosTable)
      .set({
        metadata: late
          ? metadataNow
          : { ...metadataNow, renderAttempts: attempts + 1 },
        // Late: handed back for the next poll or job pass to record
        ...(late ? { lastCheckedAt: null } : {}),
        updatedAt: new Date()
      })
      .where(
        and(
          eq(postVideosTable.id, row.id),
          eq(postVideosTable.status, 'generating')
        )
      )
    if (late) return
  }
  const scenes = (metadataNow.scenes as SceneImage[] | undefined) ?? []

  let video
  try {
    // Charged to the post: matching the look of their posts may call a model
    video = await withAiSpend(
      { source: 'posts', accountId: draft.accountId, draftId: draft.id },
      () =>
        recorder.render({
          prompt: row.prompt,
          accountId: draft.accountId,
          platform: videoSpecOf(draft.formatId).platform,
          scenes
        })
    )
  } catch (err) {
    if (err instanceof RendererUnavailableError && onVercel()) {
      // This function was deployed without the browser (only the video and
      // job routes carry it): hand it back for one that has it.
      await db
        .update(postVideosTable)
        .set({
          lastCheckedAt: null,
          metadata: { ...metadataNow, renderAttempts: attempts },
          updatedAt: new Date()
        })
        .where(
          and(
            eq(postVideosTable.id, row.id),
            eq(postVideosTable.status, 'generating')
          )
        )
      return
    }
    console.error(`Could not record video ${row.id}:`, err)
    const reason = err instanceof Error && err.message ? err.message : ''
    await fail(
      row.id,
      `The video could not be recorded${reason ? `: ${reason}` : '.'}`
    )
    return
  }

  let videoUrl: string
  try {
    videoUrl = await storeDraftFile(draft.id, {
      buffer: video.bytes,
      mediaType: video.mediaType,
      extension: 'mp4'
    })
  } catch (err) {
    console.error(`Could not store video ${row.id}:`, err)
    await fail(row.id, 'The video was recorded but could not be saved. Try again.')
    return
  }
  await markReady(row, draft.id, {
    videoUrl,
    mediaType: video.mediaType,
    byteSize: video.bytes.length,
    durationSeconds: Math.max(1, Math.round(video.seconds)),
    metadata: {
      ...metadataNow,
      ...video.metadata,
      renderAttempts: attempts + 1,
      warnings: [
        ...video.warnings,
        ...(typeof metadataNow.sceneError === 'string' && scenes.length === 0
          ? [metadataNow.sceneError]
          : [])
      ]
    }
  })
}

/**
 * Moves a running video on: records it (see record). A video an AI model
 * was making, before videos were recorded, can no longer finish.
 */
async function advance(
  row: PostVideo,
  draft: VideoDraft,
  opts: { startScenesBy?: number } = {}
): Promise<void> {
  if (row.provider !== RECORDER_PROVIDER) {
    await fail(
      row.id,
      'This video was being made by a video model the app no longer uses. Record it again.'
    )
    return
  }
  await record(row, draft, opts)
}

/** The newest rows of a post's videos, newest first. */
const recentVideos = (draftId: string) =>
  db
    .select()
    .from(postVideosTable)
    .where(
      and(
        eq(postVideosTable.draftId, draftId),
        sql`${postVideosTable.status} <> 'superseded'`
      )
    )
    .orderBy(desc(postVideosTable.version))
    .limit(5)

/**
 * Where a post's video stands. A video not yet recorded is recorded after
 * this answer. Null when the post is not this identity's or is not a video.
 */
export async function getPostVideoState(
  accountId: string,
  draftId: string
): Promise<VideoState | null> {
  const draft = await loadVideoDraft(accountId, draftId)
  if (!draft) return null
  const spec = videoSpecOf(draft.formatId)

  const rows = await recentVideos(draftId)
  const running = rows.find(r => r.status === 'generating')
  // Recorded after this answer, which the page needs at once; one not yet
  // claimed (drafting started it, or its recording died) starts here.
  if (running) inBackground(() => advance(running, draft))

  let locked: string | null = null
  try {
    await assertPostChangeable(draft)
  } catch (err) {
    locked =
      err instanceof Error ? err.message : 'This post can no longer change.'
  }

  const ready = rows.find(r => r.status === 'ready')
  const newest = rows[0]
  const failed =
    newest?.status === 'failed' && (!ready || newest.version > ready.version)
      ? newest
      : undefined

  return {
    spec,
    unavailable: unavailableReason(),
    locked,
    noScript: !draft.hook.trim(),
    running: running
      ? await viewOf(running, fileNameFor(draft, running.version))
      : null,
    ready: ready
      ? await viewOf(ready, fileNameFor(draft, ready.version))
      : null,
    failed: failed
      ? await viewOf(failed, fileNameFor(draft, failed.version))
      : null
  }
}

/**
 * Starts a video for the post: from the post page (Record video), or by
 * drafting right after it writes the script. It is recorded after the
 * response. Throws PostLockedError for a post that went out.
 */
export async function startPostVideo(options: {
  accountId: string
  draftId: string
  /** Who started it, kept with the video. */
  trigger: 'drafting' | 'reviewer'
}): Promise<StartVideoOutcome> {
  const draft = await loadVideoDraft(options.accountId, options.draftId)
  if (!draft) return { status: 'not_found' }
  await assertPostChangeable(draft)
  // Made from a video the user uploaded: a recording would replace it.
  if ((draft.payload?.upload as { kind?: unknown } | undefined)?.kind === 'video') {
    return {
      status: 'failed',
      error: 'This post goes out with the video you uploaded; it is not recorded.'
    }
  }

  const unavailable = unavailableReason()
  if (unavailable) return { status: 'unavailable', error: unavailable }
  if (!draft.hook.trim()) {
    return {
      status: 'failed',
      error: 'The script has no spoken words to make a video from.'
    }
  }

  // The script is filmed as it is now: its plan is the video's prompt
  const spec = videoSpecOf(draft.formatId)
  const plan = planVideo({ post: draft })

  // The row is the claim: a second request meets the unique index.
  let rowId: string
  try {
    const [row] = await db
      .insert(postVideosTable)
      .values({
        draftId: draft.id,
        version: sql`(select coalesce(max(${postVideosTable.version}), 0) + 1 from ${postVideosTable} where ${postVideosTable.draftId} = ${draft.id})`,
        status: 'generating',
        provider: RECORDER_PROVIDER,
        modelId: RECORDER_MODEL_ID,
        prompt: JSON.stringify(plan),
        aspectRatio: spec.aspectRatio,
        width: spec.width,
        height: spec.height,
        durationSeconds: plannedSeconds(plan),
        metadata: {
          method: 'product-video',
          fps: spec.fps,
          trigger: options.trigger
        }
      })
      .returning({ id: postVideosTable.id })
    rowId = row!.id
  } catch (err) {
    if (isUniqueViolation(err)) return { status: 'already_running' }
    throw err
  }

  // Recorded after the response; the post page shows it once it is ready.
  inBackground(async () => {
    const [row] = await db
      .select()
      .from(postVideosTable)
      .where(eq(postVideosTable.id, rowId))
      .limit(1)
    if (row) await advance(row, draft)
  })
  return { status: 'started', videoId: rowId }
}

/**
 * Records every video not yet recorded, for the job timers: a video drafting
 * started is made even when nobody opens its post. Matching the look of
 * their posts is charged to each post. Returns how many were looked at.
 */
export async function finishPendingVideos(limit = 20): Promise<number> {
  const rows = await db
    .select({ video: postVideosTable, accountId: postDraftsTable.accountId })
    .from(postVideosTable)
    .innerJoin(postDraftsTable, eq(postDraftsTable.id, postVideosTable.draftId))
    .where(eq(postVideosTable.status, 'generating'))
    .orderBy(postVideosTable.createdAt)
    .limit(limit)
  const passStarted = Date.now()
  for (const { video, accountId } of rows) {
    // A recording takes a minute or two: none starts late in the pass.
    if (Date.now() - passStarted > RENDER_PASS_BUDGET_MS) break
    try {
      const draft = await loadVideoDraft(accountId, video.draftId)
      if (!draft) continue
      await withAiSpend(
        { source: 'posts', accountId, draftId: video.draftId },
        () =>
          advance(video, draft, {
            startScenesBy: passStarted + PASS_SCENES_START_MS
          })
      )
    } catch (err) {
      console.error(`Could not move video ${video.id} on:`, err)
    }
  }
  return rows.length
}

/**
 * The post's newest ready video, as publishing sends it: the provider links
 * to it by id (/api/publishing-media/video), and the route serves the file.
 * Null when it has none.
 */
export async function publishableVideoOf(draftId: string): Promise<{
  id: string
  mediaType: string
  byteSize: number | null
  /** Recorded by the app; false for a video the user uploaded. */
  aiGenerated: boolean
} | null> {
  const [video] = await db
    .select({
      id: postVideosTable.id,
      videoUrl: postVideosTable.videoUrl,
      mediaType: postVideosTable.mediaType,
      byteSize: postVideosTable.byteSize,
      provider: postVideosTable.provider
    })
    .from(postVideosTable)
    .where(
      and(
        eq(postVideosTable.draftId, draftId),
        eq(postVideosTable.status, 'ready')
      )
    )
    .orderBy(desc(postVideosTable.version))
    .limit(1)
  if (!video?.videoUrl) return null
  return {
    id: video.id,
    mediaType: video.mediaType ?? 'video/mp4',
    byteSize: video.byteSize,
    aiGenerated: video.provider !== UPLOADED_VIDEO_PROVIDER
  }
}

/**
 * A ready video's file, for the route that serves it to a publishing
 * provider: its place in the bucket, type and size. Null for any other row.
 */
export async function readyVideoFile(videoId: string): Promise<{
  videoUrl: string
  mediaType: string
  byteSize: number | null
} | null> {
  const [video] = await db
    .select({
      videoUrl: postVideosTable.videoUrl,
      mediaType: postVideosTable.mediaType,
      byteSize: postVideosTable.byteSize
    })
    .from(postVideosTable)
    .where(
      and(eq(postVideosTable.id, videoId), eq(postVideosTable.status, 'ready'))
    )
    .limit(1)
  if (!video?.videoUrl) return null
  return {
    videoUrl: video.videoUrl,
    mediaType: video.mediaType ?? 'video/mp4',
    byteSize: video.byteSize
  }
}
