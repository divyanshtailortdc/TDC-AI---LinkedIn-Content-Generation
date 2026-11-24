import 'server-only'

import { db } from '@/db'
import {
  ideasTable,
  postDraftsTable,
  postVideosTable,
  type PostVideo
} from '@/db/schema'
import { formatOf } from '@/lib/formats'
import { assertPostChangeable } from '@/lib/publishing/post-lock'
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { after } from 'next/server'
import { env } from '~/env'
import { onVercel } from '~/lib/function-limit'
import {
  assertWithinAiSpendLimit,
  recordAiSpend,
  withAiSpend
} from '~/lib/ai/spend'
import { EMPTY_USAGE } from '~/lib/ai/usage'
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
import {
  AI_CLIP_FPS,
  AI_CLIP_SECONDS,
  estimateVideoCostUsd,
  type VideoResolution
} from './models'
import { buildVideoPrompt } from './prompt'
import {
  currentVideoProvider,
  providerFor,
  type LocalVideoProvider,
  type VideoProvider,
  type VideoRequest
} from './providers'
import { RendererUnavailableError } from './render/binaries'
import { planVideo, plannedSeconds } from './render/plan'

/**
 * A post's video, started from the post page or by drafting.
 *
 * Recorded (the product-video recorder, the default): the script is planned
 * into cards and slides when it starts, and recorded on this server after
 * the response that started it, in about a minute. A page poll or the job
 * pass that finds it not yet recorded claims and records it, so one whose
 * function died is recorded again.
 *
 * AI clips (Veo, when VIDEO_MODEL names one): started at the provider, then
 * checked on each poll until it finishes, when one poll downloads it into
 * the bucket. Every step is a short request, so nothing outlives a
 * serverless function and a generation carries on while the reviewer is
 * elsewhere.
 *
 * Cost control: the reviewer confirms the estimate the page showed (nothing,
 * for a recording), and the request is refused when it no longer matches;
 * one generation runs per post (a unique index, so a double click cannot pay
 * twice); the spending limits are checked before an AI clip starts, and its
 * cost recorded when it lands.
 */

/** How the clip is made: 1080p with its voiceover. */
const RESOLUTION: VideoResolution = '1080p'
const WITH_AUDIO = true
/** Providers are asked at most this often, however many pages poll. */
const CHECK_INTERVAL_MS = 4_000
/** A start that never stored its job (the function died) is given up after this. */
const START_TIMEOUT_MS = 2 * 60_000
/** A download and upload that never finished is tried again after this. */
const FINISH_TIMEOUT_MS = 3 * 60_000
/**
 * A clip its provider still calls pending after this is given up on. Asked
 * first: a clip that finished while nobody looked is still kept.
 */
const GENERATION_TIMEOUT_MS = 30 * 60_000
const MAX_SAVE_ATTEMPTS = 3
/**
 * A recording claimed this long ago and not finished died with its function
 * (they end at 300 s): another may claim it.
 */
const RENDER_LEASE_MS = 6 * 60_000
/** Recordings of one video started before it is given up on. */
const MAX_RENDER_ATTEMPTS = 3
/** The job pass starts no recording this long in, so it ends in its function's time. */
const RENDER_PASS_BUDGET_MS = 140_000

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
  direction: string | null
  estimatedCostUsd: number
  costUsd: number | null
  modelLabel: string
}

export interface VideoState {
  spec: VideoSpec
  /** Null when videos cannot be made now; `unavailable` says why. */
  estimateUsd: number | null
  unavailable: string | null
  modelLabel: string | null
  /** Recorded on the server (no AI model, no cost, no direction to give). */
  recorded: boolean
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
  | { status: 'estimate_changed'; estimateUsd: number }
  | { status: 'unavailable'; error: string }
  | { status: 'failed'; error: string }

type VideoDraft = {
  id: string
  accountId: string
  formatId: VideoFormatId
  ideaId: string | null
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
      formatId: postDraftsTable.formatId,
      ideaId: postDraftsTable.ideaId,
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

/** An AI clip's request: one clip of the model's length. */
function requestFor(spec: VideoSpec, prompt: string): VideoRequest {
  return {
    prompt,
    aspectRatio: spec.aspectRatio,
    resolution: RESOLUTION,
    seconds: AI_CLIP_SECONDS,
    fps: AI_CLIP_FPS,
    audio: WITH_AUDIO
  }
}

const estimateFor = (provider: VideoProvider, spec: VideoSpec) =>
  estimateVideoCostUsd(provider.model, {
    seconds: provider.kind === 'remote' ? AI_CLIP_SECONDS : spec.seconds,
    resolution: RESOLUTION,
    audio: WITH_AUDIO
  })

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
function unavailableReason(
  provider: ReturnType<typeof currentVideoProvider>
): string | null {
  if (!provider.provider) return provider.reason
  if (!env.STORAGE_BUCKET) {
    return 'Videos are kept in object storage; set STORAGE_BUCKET to make them.'
  }
  return null
}

const usd = (value: string | null) => (value === null ? null : Number(value))

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
    direction: row.direction,
    estimatedCostUsd: Number(row.estimatedCostUsd),
    costUsd: usd(row.costUsd),
    modelLabel:
      providerFor(row.provider, row.modelId).provider?.model.label ??
      row.modelId
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
      and(
        eq(postVideosTable.id, id),
        inArray(postVideosTable.status, ['generating', 'finishing'])
      )
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
    costUsd: number
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
        costUsd: video.costUsd.toFixed(4),
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
  provider: LocalVideoProvider
): Promise<void> {
  const now = Date.now()
  if (now - row.createdAt.getTime() > GENERATION_TIMEOUT_MS) {
    await fail(row.id, 'The video took too long to record. Try again.')
    return
  }
  const metadata = row.metadata ?? {}
  const attempts = Number(metadata.renderAttempts ?? 0)
  if (attempts >= MAX_RENDER_ATTEMPTS) {
    await fail(row.id, 'The video could not be recorded. Try again.')
    return
  }
  const [claimed] = await db
    .update(postVideosTable)
    .set({
      lastCheckedAt: new Date(),
      metadata: { ...metadata, renderAttempts: attempts + 1 },
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
    .returning({ id: postVideosTable.id })
  if (!claimed) return

  let video
  try {
    video = await provider.render({
      prompt: row.prompt,
      accountId: draft.accountId
    })
  } catch (err) {
    if (err instanceof RendererUnavailableError && onVercel()) {
      // This function was deployed without the browser (only the video and
      // job routes carry it): hand it back for one that has it.
      await db
        .update(postVideosTable)
        .set({ lastCheckedAt: null, metadata, updatedAt: new Date() })
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
    costUsd: 0,
    durationSeconds: Math.max(1, Math.round(video.seconds)),
    metadata: {
      ...metadata,
      renderAttempts: attempts + 1,
      warnings: video.warnings,
      costSource: 'none'
    }
  })
}

/**
 * Moves a running generation on. A recording is recorded (see record). An
 * AI clip's provider is asked (at most every few seconds, whoever polls),
 * and once it is done the clip is claimed, so one poll alone downloads and
 * stores it. Never throws: a provider that cannot be reached is asked again
 * on the next poll.
 */
async function advance(row: PostVideo, draft: VideoDraft): Promise<void> {
  const now = Date.now()
  const age = now - row.createdAt.getTime()

  const local = providerFor(row.provider, row.modelId).provider
  if (local?.kind === 'local') {
    await record(row, draft, local)
    return
  }

  if (row.status === 'finishing') {
    // The poll that claimed it stopped before storing it: let another try.
    if (now - row.updatedAt.getTime() > FINISH_TIMEOUT_MS) {
      await db
        .update(postVideosTable)
        .set({ status: 'generating', updatedAt: new Date() })
        .where(
          and(
            eq(postVideosTable.id, row.id),
            eq(postVideosTable.status, 'finishing')
          )
        )
    }
    return
  }
  if (!row.operation) {
    // Being started right now, or its start died before saving the job.
    if (age > START_TIMEOUT_MS)
      await fail(row.id, 'The video could not be started. Try again.')
    return
  }
  // Claims this check, so pages polling at once ask the provider once.
  const [due] = await db
    .update(postVideosTable)
    .set({ lastCheckedAt: new Date() })
    .where(
      and(
        eq(postVideosTable.id, row.id),
        eq(postVideosTable.status, 'generating'),
        or(
          isNull(postVideosTable.lastCheckedAt),
          lt(postVideosTable.lastCheckedAt, new Date(now - CHECK_INTERVAL_MS))
        )
      )
    )
    .returning({ id: postVideosTable.id })
  if (!due) return

  const found = providerFor(row.provider, row.modelId)
  if (!found.provider || found.provider.kind !== 'remote') {
    await fail(
      row.id,
      found.provider ? 'This video cannot be checked.' : found.reason
    )
    return
  }

  let result
  try {
    result = await found.provider.check(row.operation)
  } catch (err) {
    console.error(`Could not check video ${row.id}:`, err)
    return
  }
  if (result.status === 'pending') {
    if (age > GENERATION_TIMEOUT_MS) {
      await fail(row.id, 'The video took too long to make. Try again.')
    }
    return
  }
  if (result.status === 'failed') {
    await fail(row.id, result.error)
    return
  }

  // Done: one poll stores it.
  const [claimed] = await db
    .update(postVideosTable)
    .set({ status: 'finishing', updatedAt: new Date() })
    .where(
      and(
        eq(postVideosTable.id, row.id),
        eq(postVideosTable.status, 'generating')
      )
    )
    .returning({ id: postVideosTable.id })
  if (!claimed) return

  const metadata = row.metadata ?? {}
  let videoUrl: string
  try {
    videoUrl = await storeDraftFile(draft.id, {
      buffer: result.video.bytes,
      mediaType: result.video.mediaType,
      extension: result.video.mediaType === 'video/quicktime' ? 'mov' : 'mp4'
    })
  } catch (err) {
    console.error(`Could not store video ${row.id}:`, err)
    const attempts = Number(metadata.saveAttempts ?? 0) + 1
    if (attempts >= MAX_SAVE_ATTEMPTS) {
      await fail(
        row.id,
        'The video was made but could not be saved. Try again.'
      )
    } else {
      await db
        .update(postVideosTable)
        .set({
          status: 'generating',
          metadata: { ...metadata, saveAttempts: attempts },
          updatedAt: new Date()
        })
        .where(
          and(
            eq(postVideosTable.id, row.id),
            eq(postVideosTable.status, 'finishing')
          )
        )
    }
    return
  }

  const estimated = Number(row.estimatedCostUsd)
  const billed = result.costUsd
  await markReady(row, draft.id, {
    videoUrl,
    mediaType: result.video.mediaType,
    byteSize: result.video.bytes.length,
    costUsd: billed ?? estimated,
    metadata: {
      ...metadata,
      warnings: [
        ...((metadata.warnings as string[] | undefined) ?? []),
        ...result.warnings
      ],
      costSource: billed === null ? 'estimate' : 'gateway'
    }
  })
  await recordAiSpend({
    stage: 'video',
    modelId: row.modelId,
    usage: {
      ...EMPTY_USAGE,
      calls: 1,
      costUsd: billed ?? estimated,
      billedCalls: billed === null ? 0 : 1,
      estimatedCalls: billed === null ? 1 : 0
    }
  })
}

/** Whether a video is made by recording it here, rather than by a provider. */
const isRecording = (row: PostVideo) =>
  providerFor(row.provider, row.modelId).provider?.kind === 'local'

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
 * Where a post's video stands, after moving a running generation on. Null
 * when the post is not this identity's or is not a video. Call inside
 * withAiSpend: a finished clip's cost is recorded here.
 */
export async function getPostVideoState(
  accountId: string,
  draftId: string
): Promise<VideoState | null> {
  const draft = await loadVideoDraft(accountId, draftId)
  if (!draft) return null
  const spec = videoSpecOf(draft.formatId)

  let rows = await recentVideos(draftId)
  const active = rows.find(
    r => r.status === 'generating' || r.status === 'finishing'
  )
  if (active && isRecording(active)) {
    // Recorded after this answer, which the page needs at once; one not
    // yet claimed (drafting started it, or its recording died) starts here.
    inBackground(() => advance(active, draft))
  } else if (active) {
    try {
      await advance(active, draft)
    } catch (err) {
      console.error(`Could not move video ${active.id} on:`, err)
    }
    rows = await recentVideos(draftId)
  }

  const provider = currentVideoProvider()
  const unavailable = unavailableReason(provider)
  let locked: string | null = null
  try {
    await assertPostChangeable(draft)
  } catch (err) {
    locked =
      err instanceof Error ? err.message : 'This post can no longer change.'
  }

  const running = rows.find(
    r => r.status === 'generating' || r.status === 'finishing'
  )
  const ready = rows.find(r => r.status === 'ready')
  const newest = rows[0]
  const failed =
    newest?.status === 'failed' && (!ready || newest.version > ready.version)
      ? newest
      : undefined

  return {
    spec,
    estimateUsd:
      provider.provider && !unavailable
        ? estimateFor(provider.provider, spec)
        : null,
    unavailable,
    modelLabel: provider.provider?.model.label ?? null,
    recorded: provider.provider?.kind === 'local',
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

async function ideaTopic(ideaId: string | null): Promise<string | null> {
  if (!ideaId) return null
  const [idea] = await db
    .select({ title: ideasTable.title })
    .from(ideasTable)
    .where(eq(ideasTable.id, ideaId))
    .limit(1)
  return idea?.title || null
}

function buildPromptFor(
  draft: VideoDraft,
  topic: string | null,
  direction?: string | null
) {
  return buildVideoPrompt({
    formatId: draft.formatId,
    post: draft,
    topic,
    direction
  })
}

/**
 * Starts a video for the post. From the post page, once the reviewer has
 * confirmed its cost: `confirmedEstimateUsd` is what the page showed, and the
 * request is refused when the cost is no longer that. Null when drafting
 * starts it on its own, right after writing the script. Call inside
 * withAiSpend, so the spending limits apply. Throws PostLockedError for a
 * post that went out, and AiSpendLimitError past a limit.
 */
export async function startPostVideo(options: {
  accountId: string
  draftId: string
  /** What the reviewer confirmed; null for a video drafting starts. */
  confirmedEstimateUsd: number | null
  direction?: string | null
}): Promise<StartVideoOutcome> {
  const draft = await loadVideoDraft(options.accountId, options.draftId)
  if (!draft) return { status: 'not_found' }
  await assertPostChangeable(draft)

  const found = currentVideoProvider()
  const unavailable = unavailableReason(found)
  if (unavailable || !found.provider) {
    return {
      status: 'unavailable',
      error: unavailable ?? 'Video generation is not set up.'
    }
  }
  const provider = found.provider
  if (!draft.hook.trim()) {
    return {
      status: 'failed',
      error: 'The script has no spoken words to make a video from.'
    }
  }

  const spec = videoSpecOf(draft.formatId)
  const estimateUsd = estimateFor(provider, spec)
  if (
    options.confirmedEstimateUsd !== null &&
    Math.abs(estimateUsd - options.confirmedEstimateUsd) > 0.005
  ) {
    return { status: 'estimate_changed', estimateUsd }
  }
  const recorded = provider.kind === 'local'
  // A recording costs nothing; an AI clip must fit the spending limits.
  if (!recorded) await assertWithinAiSpendLimit()

  const trigger = options.confirmedEstimateUsd === null ? 'drafting' : 'reviewer'
  // A recording films the script as it is: its plan is its prompt, and it
  // takes no direction.
  const plan = recorded ? planVideo({ post: draft }) : null
  const direction = plan ? null : options.direction?.trim() || null
  const prompt = plan
    ? JSON.stringify(plan)
    : buildPromptFor(draft, await ideaTopic(draft.ideaId), direction)
  const metadata = plan
    ? { method: 'product-video', audio: false, fps: spec.fps, trigger }
    : { resolution: RESOLUTION, audio: WITH_AUDIO, fps: AI_CLIP_FPS, trigger }

  // The row is the claim: inserted before the provider is called, so a second
  // request meets the unique index and nothing is paid twice.
  let rowId: string
  try {
    const [row] = await db
      .insert(postVideosTable)
      .values({
        draftId: draft.id,
        version: sql`(select coalesce(max(${postVideosTable.version}), 0) + 1 from ${postVideosTable} where ${postVideosTable.draftId} = ${draft.id})`,
        status: 'generating',
        provider: provider.name,
        modelId: provider.model.id,
        prompt,
        direction,
        aspectRatio: spec.aspectRatio,
        width: spec.width,
        height: spec.height,
        durationSeconds: plan ? plannedSeconds(plan) : AI_CLIP_SECONDS,
        estimatedCostUsd: estimateUsd.toFixed(4),
        metadata
      })
      .returning({ id: postVideosTable.id })
    rowId = row!.id
  } catch (err) {
    if (isUniqueViolation(err)) return { status: 'already_running' }
    throw err
  }

  if (provider.kind === 'local') {
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

  try {
    const started = await provider.start(requestFor(spec, prompt))
    await db
      .update(postVideosTable)
      .set({
        operation: started.operation as object,
        metadata: { ...metadata, warnings: started.warnings },
        updatedAt: new Date()
      })
      .where(eq(postVideosTable.id, rowId))
    return { status: 'started', videoId: rowId }
  } catch (err) {
    console.error(`Could not start a video for draft ${draft.id}:`, err)
    const error =
      err instanceof Error && err.message
        ? `The video could not be started: ${err.message}`
        : 'The video could not be started.'
    await fail(rowId, error)
    return { status: 'failed', error }
  }
}

/**
 * Moves every running generation on, for the job timers: a video drafting
 * started is finished and stored even when nobody opens its post. Each is
 * charged to its identity. Returns how many were looked at.
 */
export async function finishPendingVideos(limit = 20): Promise<number> {
  const rows = await db
    .select({ video: postVideosTable, accountId: postDraftsTable.accountId })
    .from(postVideosTable)
    .innerJoin(postDraftsTable, eq(postDraftsTable.id, postVideosTable.draftId))
    .where(inArray(postVideosTable.status, ['generating', 'finishing']))
    .orderBy(postVideosTable.createdAt)
    .limit(limit)
  const passStarted = Date.now()
  for (const { video, accountId } of rows) {
    // A recording takes a minute or two: none starts late in the pass.
    if (
      isRecording(video) &&
      Date.now() - passStarted > RENDER_PASS_BUDGET_MS
    )
      continue
    try {
      const draft = await loadVideoDraft(accountId, video.draftId)
      if (!draft) continue
      await withAiSpend({ source: 'posts', accountId, draftId: video.draftId }, () =>
        advance(video, draft)
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
} | null> {
  const [video] = await db
    .select({
      id: postVideosTable.id,
      videoUrl: postVideosTable.videoUrl,
      mediaType: postVideosTable.mediaType,
      byteSize: postVideosTable.byteSize
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
    byteSize: video.byteSize
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

/**
 * What one video costs now, with the model that makes it: for Create posts,
 * which starts a video for every Reel and Short it drafts. Null when videos
 * cannot be made (`unavailable` says why).
 */
export function currentVideoEstimate(): {
  estimateUsd: number | null
  modelLabel: string | null
  /** Recorded on the server: no AI model and no cost. */
  recorded: boolean
  seconds: number
  unavailable: string | null
} {
  const spec = videoSpecOf('instagram.reel')
  const found = currentVideoProvider()
  const unavailable = unavailableReason(found)
  return {
    estimateUsd:
      found.provider && !unavailable ? estimateFor(found.provider, spec) : null,
    modelLabel: found.provider?.model.label ?? null,
    recorded: found.provider?.kind === 'local',
    seconds:
      found.provider?.kind === 'remote' ? AI_CLIP_SECONDS : spec.seconds,
    unavailable
  }
}
