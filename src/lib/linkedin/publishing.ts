import {
  accountsTable,
  type LinkedinConnection,
  linkedinConnectionsTable,
  type LinkedinPublication,
  linkedinPublicationsTable,
  postDraftsTable,
  postMediaTable
} from '@/db/schema'
import { isUniqueViolation } from '@/lib/db-errors'
import { linkedInPostText } from '@/lib/post-text'
import {
  instantOf,
  localDayKey,
  parseTimeOfDay,
  SCHEDULE_GRACE_MS,
  zonedParts,
  zoneOf
} from '@/lib/schedule-time'
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  sql
} from 'drizzle-orm'
import {
  addComment,
  type ApiContext,
  createPost,
  LinkedInApiError,
  PostImageError,
  postUrl,
  uploadImage
} from './api'
import {
  COMMENTARY_MAX_LENGTH,
  toLittleText,
  visibleLength
} from './commentary'
import {
  assertCanPublish,
  ConnectionError,
  getConnection,
  type LinkedInDb,
  markExpired,
  usableAccessToken
} from './connection'
import { type FetchFn, type LinkedInAppConfig, personUrn } from './oauth'
import { postRequested as postRequestedSql } from './publication-queries'
import type {
  PublicationErrorCode,
  PublicationStatus,
  PublicationTrigger
} from './status'

/**
 * Publishing approved posts to LinkedIn. Publish now, Schedule and
 * auto-publishing all go through the same steps:
 *
 *   requestPublication   a `scheduled` row, refused unless the post is the
 *                        user's, approved, not yet posted, and LinkedIn is
 *                        connected. The partial unique index allows one live
 *                        publication per post, so a double click or a second
 *                        tab cannot queue it twice.
 *   claim*               scheduled → publishing, a conditional update: only
 *                        one worker (or request) wins a row.
 *   executePublication   checks everything again, then uploads the image and
 *                        creates the post, unless the claim was lost meanwhile
 *                        (a cancel, a disconnect); records the post's URN at
 *                        once.
 *
 * Duplicates: creating a post is not idempotent and member tokens cannot read
 * posts back, so once the create request may have reached LinkedIn the row is
 * never retried by itself (`unknown_outcome`). Only failures where LinkedIn
 * certainly made nothing (refused connections, 429, 503, anything before the
 * create request) are retried, with backoff, up to maxAttempts.
 */

export type PublishDeps = {
  database: LinkedInDb
  config: LinkedInAppConfig
  /** For LinkedIn's API and OAuth; a stub in tests. */
  fetchFn?: FetchFn
  /** The post's image, or null for none. */
  loadImage?: (draftId: string) => Promise<PostImage | null>
  now?: () => Date
}

export type PostImage = {
  bytes: Buffer
  mediaType: string
  altText: string | null
}

/** A publication's metadata, with what this file keeps beyond the schema's type. */
type PublicationMetadata = LinkedinPublication['metadata'] & {
  /** The requester's zone: the day the post is marked posted on. */
  timezone?: string
}

/** Before the second and the third attempt (maxAttempts is 3). */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000]

/** A publishing row locked longer than this belongs to a process that died. */
export const STALE_LOCK_MS = 10 * 60_000

/** Scheduling further ahead than this is refused (and LinkedIn tokens last 60 days). */
const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60_000

/** A larger image is refused, and its download stopped. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** The image types a post can carry (uploadImage turns WebP into PNG). */
const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
])

export class PublishRequestError extends Error {
  constructor(
    message: string,
    readonly code:
      | PublicationErrorCode
      | 'not_found'
      | 'already_queued'
      | 'invalid_time'
      | 'confirm_unknown_outcome'
  ) {
    super(message)
    this.name = 'PublishRequestError'
  }
}

const nowOf = (deps: Pick<PublishDeps, 'now'>) => deps.now?.() ?? new Date()

/**
 * The user's own post, through the identity that owns it. A post of another
 * user's identity is not found, exactly like one that does not exist.
 */
async function findOwnedDraft(
  database: LinkedInDb,
  userId: string,
  draftId: string
) {
  const [draft] = await database
    .select({
      id: postDraftsTable.id,
      hook: postDraftsTable.hook,
      body: postDraftsTable.body,
      cta: postDraftsTable.cta,
      hashtags: postDraftsTable.hashtags,
      firstComment: postDraftsTable.firstComment,
      status: postDraftsTable.status,
      postedAt: postDraftsTable.postedAt
    })
    .from(postDraftsTable)
    .innerJoin(accountsTable, eq(accountsTable.id, postDraftsTable.accountId))
    .where(
      and(eq(postDraftsTable.id, draftId), eq(accountsTable.userId, userId))
    )
    .limit(1)
  return draft ?? null
}

/**
 * The post's text for LinkedIn, if it can go out: approved, not marked
 * posted and within LinkedIn's length. Checked when it is queued and again
 * when it is published (it may have changed in between).
 */
function assertPublishable(
  draft: NonNullable<Awaited<ReturnType<typeof findOwnedDraft>>>
): string {
  if (draft.status !== 'approved') {
    throw new PublishRequestError(
      'Only an approved post can be published.',
      'not_approved'
    )
  }
  if (draft.postedAt) {
    throw new PublishRequestError(
      'This post is already marked as posted on LinkedIn.',
      'already_posted'
    )
  }
  const text = linkedInPostText(draft)
  if (visibleLength(text) > COMMENTARY_MAX_LENGTH) {
    throw new PublishRequestError(
      `The post is longer than LinkedIn's ${COMMENTARY_MAX_LENGTH} characters. Shorten it and try again.`,
      'too_long'
    )
  }
  return text
}

/**
 * Queues a post to publish at `scheduledAt` (now, for Publish now). Every
 * rule is checked here, and again when it is published. Throws only
 * PublishRequestError for a refusal.
 *
 * When the post's last attempt may already have reached LinkedIn
 * (unknown_outcome), it is refused with `confirm_unknown_outcome` until the
 * user confirms they checked their profile: whether they publish now or
 * schedule it, it could otherwise appear twice.
 */
export async function requestPublication(
  database: LinkedInDb,
  input: {
    userId: string
    draftId: string
    trigger: Exclude<PublicationTrigger, 'auto'>
    scheduledAt: Date
    confirmedNotPublished?: boolean
    /** The viewer's IANA zone (validated by the caller): the day it is marked posted on. */
    timezone?: string | null
  },
  now = new Date()
): Promise<LinkedinPublication> {
  const draft = await findOwnedDraft(database, input.userId, input.draftId)
  if (!draft) throw new PublishRequestError('Post not found.', 'not_found')
  assertPublishable(draft)
  if (input.trigger === 'scheduled') {
    const ahead = input.scheduledAt.getTime() - now.getTime()
    if (!Number.isFinite(ahead) || ahead < 60_000) {
      throw new PublishRequestError(
        'Pick a time at least a minute from now.',
        'invalid_time'
      )
    }
    if (ahead > MAX_SCHEDULE_AHEAD_MS) {
      throw new PublishRequestError(
        'Pick a time within the next year.',
        'invalid_time'
      )
    }
  }
  if (!input.confirmedNotPublished) {
    const [last] = await database
      .select({
        status: linkedinPublicationsTable.status,
        errorCode: linkedinPublicationsTable.errorCode
      })
      .from(linkedinPublicationsTable)
      .where(eq(linkedinPublicationsTable.draftId, draft.id))
      .orderBy(desc(linkedinPublicationsTable.createdAt))
      .limit(1)
    if (last?.status === 'failed' && last.errorCode === 'unknown_outcome') {
      throw new PublishRequestError(
        'The last attempt may have reached LinkedIn. Check your profile, then confirm it is not there to publish again.',
        'confirm_unknown_outcome'
      )
    }
  }
  try {
    assertCanPublish(await getConnection(database, input.userId))
  } catch (err) {
    throw err instanceof ConnectionError
      ? new PublishRequestError(err.message, err.code)
      : err
  }
  try {
    const [row] = await database
      .insert(linkedinPublicationsTable)
      .values({
        userId: input.userId,
        draftId: draft.id,
        trigger: input.trigger,
        status: 'scheduled',
        scheduledAt: input.scheduledAt,
        nextAttemptAt: input.scheduledAt,
        metadata: (input.timezone
          ? { timezone: input.timezone }
          : {}) as PublicationMetadata
      })
      .returning()
    return row!
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new PublishRequestError(
        'This post is already scheduled or published.',
        'already_queued'
      )
    }
    throw err
  }
}

/** Calls off a publication that has not started. Null when there is none to cancel. */
export async function cancelPublication(
  database: LinkedInDb,
  userId: string,
  publicationId: string,
  now = new Date()
): Promise<LinkedinPublication | null> {
  const [row] = await database
    .update(linkedinPublicationsTable)
    .set({ status: 'cancelled', error: null, errorCode: null, updatedAt: now })
    .where(
      and(
        eq(linkedinPublicationsTable.id, publicationId),
        eq(linkedinPublicationsTable.userId, userId),
        eq(linkedinPublicationsTable.status, 'scheduled')
      )
    )
    .returning()
  return row ?? null
}

/** One of the user's publications as it stands now, or null. */
export async function getPublication(
  database: LinkedInDb,
  userId: string,
  publicationId: string
): Promise<LinkedinPublication | null> {
  const [row] = await database
    .select()
    .from(linkedinPublicationsTable)
    .where(
      and(
        eq(linkedinPublicationsTable.id, publicationId),
        eq(linkedinPublicationsTable.userId, userId)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * Moves one due row from scheduled to publishing, or returns null when
 * another worker got there first, it was cancelled, or it is not due.
 */
export async function claimPublication(
  database: LinkedInDb,
  publicationId: string,
  now = new Date()
): Promise<LinkedinPublication | null> {
  const [row] = await database
    .update(linkedinPublicationsTable)
    .set({
      status: 'publishing',
      lockedAt: now,
      attempts: sql`${linkedinPublicationsTable.attempts} + 1`,
      updatedAt: now
    })
    .where(
      and(
        eq(linkedinPublicationsTable.id, publicationId),
        eq(linkedinPublicationsTable.status, 'scheduled'),
        lte(linkedinPublicationsTable.nextAttemptAt, now)
      )
    )
    .returning()
  return row ?? null
}

const UNREADABLE_IMAGE = "The post's image could not be read."
const IMAGE_TOO_LARGE = "The post's image is too large."

/** Throws PostImageError unless a post can carry this type of image. */
function assertImageType(mediaType: string) {
  if (!IMAGE_TYPES.has(mediaType)) {
    throw new PostImageError(
      "The post's image is not a JPEG, PNG, GIF or WebP image."
    )
  }
}

/**
 * A stock or reviewer-pasted link, fetched with the guard against internal
 * addresses (a reviewer can paste any URL). Refused past MAX_IMAGE_BYTES by
 * its Content-Length, and by counting as it arrives (then the download is
 * stopped), since that header can be missing or wrong.
 */
async function downloadImage(
  url: string
): Promise<{ bytes: Buffer; mediaType: string }> {
  const { safeFetch, UnsafeUrlError } = await import('@/lib/safe-url')
  const res = await safeFetch(url, {
    signal: AbortSignal.timeout(20_000)
  }).catch(err => {
    throw err instanceof UnsafeUrlError
      ? new PostImageError(
          `The post's image link cannot be used: ${err.message}.`
        )
      : err
  })
  if (!res.ok) {
    // A server error may pass; a missing or forbidden image will not.
    const message = `The post's image could not be downloaded (${res.status}).`
    throw res.status >= 500 ? new Error(message) : new PostImageError(message)
  }
  const mediaType = (res.headers.get('content-type') ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase()
  assertImageType(mediaType)
  if (Number(res.headers.get('content-length')) > MAX_IMAGE_BYTES) {
    await res.body?.cancel()
    throw new PostImageError(IMAGE_TOO_LARGE)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new PostImageError(UNREADABLE_IMAGE)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel()
      throw new PostImageError(IMAGE_TOO_LARGE)
    }
    chunks.push(value)
  }
  if (size === 0) throw new PostImageError(UNREADABLE_IMAGE)
  return { bytes: Buffer.concat(chunks), mediaType }
}

/**
 * The post's active image, from the database, object storage or (stock) a
 * public link. An image that cannot be used throws PostImageError; a
 * download or storage error that may pass throws a plain error.
 */
async function loadPostImage(
  database: LinkedInDb,
  draftId: string
): Promise<PostImage | null> {
  const [media] = await database
    .select({
      imageUrl: postMediaTable.imageUrl,
      altText: postMediaTable.altText
    })
    .from(postMediaTable)
    .where(
      and(
        eq(postMediaTable.draftId, draftId),
        eq(postMediaTable.status, 'active')
      )
    )
    .orderBy(desc(postMediaTable.version), desc(postMediaTable.createdAt))
    .limit(1)
  if (!media?.imageUrl) return null
  if (/^https?:\/\//i.test(media.imageUrl)) {
    return { ...(await downloadImage(media.imageUrl)), altText: media.altText }
  }
  const { decodeImageDataUrl } = await import('@/lib/media/brand-logo')
  const { loadImageDataUrl } = await import('@/lib/media/image-store')
  const image = decodeImageDataUrl(await loadImageDataUrl(media.imageUrl))
  if (!image?.buffer.length) throw new PostImageError(UNREADABLE_IMAGE)
  assertImageType(image.mediaType)
  return {
    bytes: image.buffer,
    mediaType: image.mediaType,
    altText: media.altText
  }
}

type Failure = {
  code: PublicationErrorCode
  message: string
  retryable: boolean
  httpStatus?: number
}

const NOTHING_SENT = 'Publishing failed before anything was sent to LinkedIn.'

/**
 * What a failed attempt records. Messages written for the user are kept;
 * anything else (a bug, a database error) gets a fixed message, and its
 * details go only to the log.
 */
function describeFailure(
  err: unknown,
  postRequested: boolean,
  attemptsLeft: boolean
): Failure {
  if (err instanceof LinkedInApiError) {
    return {
      code: err.code,
      message: err.message,
      retryable: err.retryable,
      httpStatus: err.status
    }
  }
  if (err instanceof ConnectionError || err instanceof PublishRequestError) {
    return {
      code: err.code as PublicationErrorCode,
      message: err.message,
      retryable: false
    }
  }
  // The image cannot be used (unreadable, too large, an unsafe link): trying
  // again cannot help, and it is no fault of LinkedIn's.
  if (err instanceof PostImageError) {
    return { code: 'internal', message: err.message, retryable: false }
  }
  // Our own failure. Before the create request nothing was published, so it
  // can be tried again; after it, the post may exist.
  if (postRequested) {
    return {
      code: 'unknown_outcome',
      message:
        'Publishing stopped after the post was sent to LinkedIn. Check your profile before trying again.',
      retryable: false
    }
  }
  return {
    code: 'internal',
    message: attemptsLeft
      ? `${NOTHING_SENT} It will be tried again.`
      : NOTHING_SENT,
    retryable: true
  }
}

const mergeMetadata = (patch: Record<string, unknown>) =>
  sql`${linkedinPublicationsTable.metadata} || ${JSON.stringify(patch)}::jsonb`

/**
 * The row while this claim holds it. A cancel, stale-lock recovery or a
 * newer claim (each claim adds an attempt) makes it match nothing, so a
 * worker that lost its row neither posts nor overwrites the outcome.
 */
const heldClaim = (publication: LinkedinPublication) =>
  and(
    eq(linkedinPublicationsTable.id, publication.id),
    eq(linkedinPublicationsTable.status, 'publishing'),
    eq(linkedinPublicationsTable.attempts, publication.attempts)
  )

/**
 * Every rule again, then what publishing needs. The post may have been
 * rejected, posted by hand or moved to someone else since it was queued.
 * Its owner is the user who queued it, and the connection is that same
 * user's: never another's.
 */
async function prepare(deps: PublishDeps, publication: LinkedinPublication) {
  const { database } = deps
  const draft = await findOwnedDraft(
    database,
    publication.userId,
    publication.draftId
  )
  if (!draft) {
    throw new PublishRequestError('The post no longer exists.', 'not_approved')
  }
  const text = assertPublishable(draft)
  const connection = await getConnection(database, publication.userId)
  assertCanPublish(connection)
  const ctx: ApiContext = {
    accessToken: await usableAccessToken(
      database,
      deps.config,
      connection,
      deps.fetchFn,
      nowOf(deps)
    ),
    apiVersion: deps.config.apiVersion,
    fetchFn: deps.fetchFn
  }
  return {
    text,
    comment: draft.firstComment?.trim() || null,
    connection,
    ctx,
    authorUrn: personUrn(connection.memberId)
  }
}

/**
 * Publishes a claimed row. Never throws: the outcome is written to the row,
 * which is returned.
 */
export async function executePublication(
  deps: PublishDeps,
  publication: LinkedinPublication
): Promise<LinkedinPublication> {
  const { database } = deps
  let postRequested = false
  try {
    const { text, comment, connection, ctx, authorUrn } = await prepare(
      deps,
      publication
    )
    try {
      const image = await (
        deps.loadImage ?? (id => loadPostImage(database, id))
      )(publication.draftId)
      const imageUrn = image ? await uploadImage(ctx, authorUrn, image) : null

      // From here on the post may exist on LinkedIn whatever happens next; the
      // mark lets recovery tell a crash here from one during the image upload.
      // No row marked: the claim was lost (cancelled, say), so stop here.
      const [marked] = await database
        .update(linkedinPublicationsTable)
        .set({
          connectionId: connection.id,
          authorUrn,
          metadata: mergeMetadata({
            postRequestedAt: nowOf(deps).toISOString(),
            ...(imageUrn && { imageUrn })
          })
        })
        .where(heldClaim(publication))
        .returning({ id: linkedinPublicationsTable.id })
      if (!marked) {
        const row = await getPublication(
          database,
          publication.userId,
          publication.id
        )
        return row ?? publication
      }
      postRequested = true

      const postUrn = await createPost(ctx, {
        authorUrn,
        commentary: toLittleText(text),
        image: imageUrn ? { urn: imageUrn, altText: image?.altText } : undefined
      })

      // The post is live. Recording that must not turn into a failure: the
      // post's URN is the only proof it exists, and a retry would duplicate it.
      const metadata = publication.metadata as PublicationMetadata
      return await recordPublished(deps, publication, {
        postUrn,
        zone: zoneOf({
          timezone: metadata.timezone ?? connection.autoPublishTimezone
        }),
        comment,
        addFirstComment: text => addComment(ctx, postUrn, authorUrn, text)
      })
    } catch (err) {
      // LinkedIn refused the token itself (usableAccessToken expires the rest).
      if (err instanceof LinkedInApiError && err.code === 'reauth_required') {
        await markExpired(database, connection, err.message, nowOf(deps)).catch(
          () => {}
        )
      }
      throw err
    }
  } catch (err) {
    return recordFailure(deps, publication, err, postRequested)
  }
}

/**
 * Writes a failed attempt to the row: scheduled again after a delay when
 * nothing can have been published and attempts are left, failed otherwise.
 * Never throws: a database error here leaves the row 'publishing', and
 * stale-lock recovery settles it later.
 */
async function recordFailure(
  deps: PublishDeps,
  publication: LinkedinPublication,
  err: unknown,
  postRequested: boolean
): Promise<LinkedinPublication> {
  const attemptsLeft = publication.attempts < publication.maxAttempts
  const failure = describeFailure(err, postRequested, attemptsLeft)
  if (failure.code === 'internal' || failure.code === 'unknown_outcome') {
    console.error(`LinkedIn publication ${publication.id} failed:`, err)
  }
  const retry = failure.retryable && attemptsLeft
  const now = nowOf(deps)
  // A larger maxAttempts than 3 keeps the last delay.
  const delay =
    RETRY_DELAYS_MS[publication.attempts - 1] ?? RETRY_DELAYS_MS.at(-1)!
  const patch = failure.httpStatus ? { httpStatus: failure.httpStatus } : {}
  const [row] = await deps.database
    .update(linkedinPublicationsTable)
    .set({
      status: retry ? 'scheduled' : 'failed',
      nextAttemptAt: retry
        ? new Date(now.getTime() + delay)
        : publication.nextAttemptAt,
      lockedAt: null,
      error: failure.message,
      errorCode: failure.code,
      // A retry starts over: its attempt has sent nothing yet.
      metadata: retry
        ? sql`(${linkedinPublicationsTable.metadata} - 'postRequestedAt' - 'imageUrn') || ${JSON.stringify(patch)}::jsonb`
        : mergeMetadata(patch),
      updatedAt: now
    })
    .where(heldClaim(publication))
    .returning()
    .catch(updateErr => {
      console.error(
        `Could not record the failure of LinkedIn publication ${publication.id}:`,
        updateErr
      )
      return []
    })
  return row ?? publication
}

/** Retries a database write once, a second later: for writes that must land. */
async function writeWithRetry<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch {
    await new Promise(resolve => setTimeout(resolve, 1000))
    return write()
  }
}

/**
 * Records a post LinkedIn has just created, then adds its first comment.
 * Never throws. If the row cannot be marked published even after a retry, the
 * URN is logged (it is the only record of the post) and the row is left
 * 'publishing', so recovery marks it unknown_outcome rather than retrying.
 */
async function recordPublished(
  deps: PublishDeps,
  publication: LinkedinPublication,
  result: {
    postUrn: string
    /** The zone of the day the post is marked posted on. */
    zone: string
    comment: string | null
    addFirstComment: (text: string) => Promise<string | null>
  }
): Promise<LinkedinPublication> {
  const { database } = deps
  const byId = eq(linkedinPublicationsTable.id, publication.id)
  const publishedAt = nowOf(deps)
  const published = {
    status: 'published' as const,
    linkedinPostUrn: result.postUrn,
    publishedAt,
    lockedAt: null,
    error: null,
    errorCode: null,
    updatedAt: publishedAt
  }
  // What the caller sees even if the database cannot be written.
  let row: LinkedinPublication = { ...publication, ...published }

  try {
    const [saved] = await writeWithRetry(() =>
      database
        .update(linkedinPublicationsTable)
        .set(published)
        .where(byId)
        .returning()
    )
    if (saved) row = saved
  } catch (err) {
    console.error(
      `LinkedIn publication ${publication.id} IS PUBLISHED as ${result.postUrn}, but it could not be recorded:`,
      err
    )
    return row
  }

  // The post shows as posted on Schedule, on the day it went out. Only a
  // display detail: the publication row above is what prevents a repeat.
  try {
    await writeWithRetry(() =>
      database
        .update(postDraftsTable)
        .set({
          postedAt: publishedAt,
          plannedFor: sql`coalesce(${postDraftsTable.plannedFor}, ${localDayKey(publishedAt, result.zone)}::date)`,
          updatedAt: publishedAt
        })
        .where(eq(postDraftsTable.id, publication.draftId))
    )
  } catch (err) {
    console.error(
      `Could not mark post ${publication.draftId} as posted after publishing it:`,
      err
    )
  }

  // The first comment is extra: if it fails the post is still published,
  // and it is never retried (it could appear twice).
  if (result.comment) {
    let outcome: Record<string, unknown>
    try {
      const commentUrn = await result.addFirstComment(result.comment)
      // LinkedIn may leave the comment's id out.
      outcome = commentUrn ? { commentUrn } : { commentAdded: true }
    } catch (err) {
      const answered =
        err instanceof LinkedInApiError && err.status
          ? ` (LinkedIn answered ${err.status})`
          : ''
      outcome = {
        commentError: `The first comment could not be added${answered}.`
      }
    }
    try {
      const [saved] = await database
        .update(linkedinPublicationsTable)
        .set({ metadata: mergeMetadata(outcome) })
        .where(byId)
        .returning()
      if (saved) row = saved
    } catch (err) {
      console.error(
        `Could not record the first comment of publication ${publication.id}:`,
        err
      )
    }
  }
  return row
}

/**
 * Rows left `publishing` by a process that died. One that never sent the
 * create request goes back in the queue (or fails, out of attempts); one that
 * did may be on LinkedIn already, so it fails as `unknown_outcome`.
 */
export async function recoverStalePublications(
  database: LinkedInDb,
  now = new Date()
): Promise<number> {
  const stale = and(
    eq(linkedinPublicationsTable.status, 'publishing'),
    lt(
      linkedinPublicationsTable.lockedAt,
      new Date(now.getTime() - STALE_LOCK_MS)
    )
  )
  const unsure = await database
    .update(linkedinPublicationsTable)
    .set({
      status: 'failed',
      lockedAt: null,
      errorCode: 'unknown_outcome',
      error:
        'Publishing was interrupted after the post was sent to LinkedIn. Check your profile before trying again.',
      updatedAt: now
    })
    .where(and(stale, postRequestedSql))
    .returning({ id: linkedinPublicationsTable.id })
  const requeued = await database
    .update(linkedinPublicationsTable)
    .set({
      status: sql`case when ${linkedinPublicationsTable.attempts} < ${linkedinPublicationsTable.maxAttempts} then 'scheduled' else 'failed' end`,
      nextAttemptAt: now,
      lockedAt: null,
      errorCode: 'internal',
      error: 'Publishing was interrupted before the post was sent.',
      updatedAt: now
    })
    .where(and(stale, sql`not (${postRequestedSql})`))
    .returning({ id: linkedinPublicationsTable.id })
  return unsure.length + requeued.length
}

/**
 * The connection's auto-publish slot that is due now, with its calendar day,
 * or null. Like dueSlot for idea runs: due from its time until
 * SCHEDULE_GRACE_MS later, and that can run past midnight (a 23:58 slot is
 * first seen at 00:00), so yesterday's slot is looked at too; the grace is
 * under a day, so at most one of the two is due. A slot that passed before
 * auto-publishing was turned on (or last saved) is never due.
 */
function dueAutoSlot(
  connection: LinkedinConnection,
  now: Date
): { slot: Date; day: string } | null {
  const minutes = parseTimeOfDay(connection.autoPublishTime)
  const enabledAt = connection.autoPublishEnabledAt
  if (minutes === null || !enabledAt) return null
  const zone = zoneOf({ timezone: connection.autoPublishTimezone })
  const today = zonedParts(now, zone)
  for (const offset of [0, -1]) {
    // Calendar arithmetic in UTC, where every day has 24 hours.
    const date = new Date(
      Date.UTC(today.year, today.month - 1, today.day + offset)
    )
    const slot = instantOf(
      {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate()
      },
      minutes,
      zone
    )
    const late = now.getTime() - slot.getTime()
    if (late >= 0 && late < SCHEDULE_GRACE_MS && enabledAt <= slot) {
      return { slot, day: date.toISOString().slice(0, 10) }
    }
  }
  return null
}

/**
 * The slot each connection's posts were last queued for, in this process
 * (`<autoPublishEnabledAt>:<day>`; every save of the setting changes the
 * first part). Once a slot's posts are queued there is nothing new to find
 * in its window, since a post changed after the slot is left alone, so it
 * is not queried again every minute. Another process simply queries once.
 */
const queuedSlots = new Map<string, string>()

/**
 * Auto-publishing: for each user who turned it on, the approved posts
 * planned for the slot's day in their zone (not posted, never queued
 * before) are queued once their time of day has come, if they were last
 * changed before that time. Nothing from before the user turned it on is
 * swept up, and a post with any earlier publication (failed, cancelled or
 * done) is left alone: auto-publishing never retries what a person or an
 * earlier attempt already decided.
 */
export async function queueAutoPublications(
  database: LinkedInDb,
  now = new Date()
): Promise<number> {
  const connections = await database
    .select()
    .from(linkedinConnectionsTable)
    .where(
      and(
        eq(linkedinConnectionsTable.autoPublish, true),
        eq(linkedinConnectionsTable.status, 'connected')
      )
    )
  let queued = 0
  for (const connection of connections) {
    const due = dueAutoSlot(connection, now)
    if (!due) continue
    const slotKey = `${connection.autoPublishEnabledAt!.getTime()}:${due.day}`
    if (queuedSlots.get(connection.id) === slotKey) continue
    const { slot } = due

    const drafts = await database
      .select({ id: postDraftsTable.id })
      .from(postDraftsTable)
      .innerJoin(accountsTable, eq(accountsTable.id, postDraftsTable.accountId))
      .where(
        and(
          eq(accountsTable.userId, connection.userId),
          eq(postDraftsTable.status, 'approved'),
          isNull(postDraftsTable.postedAt),
          eq(postDraftsTable.plannedFor, due.day),
          // Approved, planned and edited before the slot: a post approved or
          // moved onto its day after the time is not published at once.
          lte(postDraftsTable.updatedAt, slot),
          notExists(
            database
              .select({ one: sql`1` })
              .from(linkedinPublicationsTable)
              .where(eq(linkedinPublicationsTable.draftId, postDraftsTable.id))
          )
        )
      )
    if (drafts.length > 0) {
      const inserted = await database
        .insert(linkedinPublicationsTable)
        .values(
          drafts.map(draft => ({
            userId: connection.userId,
            draftId: draft.id,
            trigger: 'auto' as const,
            status: 'scheduled' as const,
            scheduledAt: slot,
            nextAttemptAt: now
          }))
        )
        // A post queued meanwhile (Publish now) keeps that one.
        .onConflictDoNothing()
        .returning({ id: linkedinPublicationsTable.id })
      queued += inserted.length
    }
    queuedSlots.set(connection.id, slotKey)
  }
  return queued
}

/**
 * One pass of the publishing worker: recover interrupted rows, queue
 * auto-publications, then publish what is due, oldest first, one at a time.
 */
export async function runDuePublications(
  deps: PublishDeps,
  options: { limit?: number } = {}
): Promise<{
  recovered: number
  queued: number
  published: number
  failed: number
}> {
  const { database } = deps
  const recovered = await recoverStalePublications(database, nowOf(deps))
  const queued = await queueAutoPublications(database, nowOf(deps))
  const due = await database
    .select({ id: linkedinPublicationsTable.id })
    .from(linkedinPublicationsTable)
    .where(
      and(
        eq(linkedinPublicationsTable.status, 'scheduled'),
        lte(linkedinPublicationsTable.nextAttemptAt, nowOf(deps))
      )
    )
    .orderBy(asc(linkedinPublicationsTable.nextAttemptAt))
    .limit(options.limit ?? 10)
  let published = 0
  let failed = 0
  for (const { id } of due) {
    let outcome: LinkedinPublication
    try {
      const claimed = await claimPublication(database, id, nowOf(deps))
      if (!claimed) continue
      outcome = await executePublication(deps, claimed)
    } catch (err) {
      // One row's failure must not stop the others in this pass.
      console.error(`LinkedIn publishing pass failed on ${id}:`, err)
      failed++
      continue
    }
    if (outcome.status === 'published') published++
    else failed++
  }
  return { recovered, queued, published, failed }
}

/** What the browser sees of a publication. */
export type PublicationSummary = {
  id: string
  status: PublicationStatus
  trigger: PublicationTrigger
  scheduledAt: string
  nextAttemptAt: string
  publishedAt: string | null
  postUrl: string | null
  error: string | null
  errorCode: PublicationErrorCode | null
  attempts: number
  commentError: string | null
}

export function toPublicationSummary(
  row: LinkedinPublication
): PublicationSummary {
  return {
    id: row.id,
    status: row.status,
    trigger: row.trigger,
    scheduledAt: row.scheduledAt.toISOString(),
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    postUrl: row.linkedinPostUrn ? postUrl(row.linkedinPostUrn) : null,
    error: row.error,
    errorCode: row.errorCode,
    attempts: row.attempts,
    commentError: row.metadata?.commentError ?? null
  }
}

/**
 * The latest publication of each post, by post id. The caller passes only
 * posts it has already scoped to the signed-in user's identity.
 */
export async function latestPublications(
  database: LinkedInDb,
  draftIds: string[]
): Promise<Map<string, PublicationSummary>> {
  const latest = new Map<string, PublicationSummary>()
  if (draftIds.length === 0) return latest
  // One row per post (its newest), not every attempt it ever had.
  const rows = await database
    .selectDistinctOn([linkedinPublicationsTable.draftId])
    .from(linkedinPublicationsTable)
    .where(inArray(linkedinPublicationsTable.draftId, draftIds))
    .orderBy(
      linkedinPublicationsTable.draftId,
      desc(linkedinPublicationsTable.createdAt)
    )
  for (const row of rows) latest.set(row.draftId, toPublicationSummary(row))
  return latest
}

/** The newest of the user's publications of one post, or null. */
export async function latestPublicationOf(
  database: LinkedInDb,
  userId: string,
  draftId: string
): Promise<PublicationSummary | null> {
  const [row] = await database
    .select()
    .from(linkedinPublicationsTable)
    .where(
      and(
        eq(linkedinPublicationsTable.draftId, draftId),
        eq(linkedinPublicationsTable.userId, userId)
      )
    )
    .orderBy(desc(linkedinPublicationsTable.createdAt))
    .limit(1)
  return row ? toPublicationSummary(row) : null
}
