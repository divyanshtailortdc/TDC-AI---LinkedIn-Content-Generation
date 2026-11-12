import {
  accountsTable,
  type PlatformConnection,
  platformConnectionsTable,
  type Publication,
  publicationsTable,
  postDraftsTable,
  postMediaTable
} from '@/db/schema'
import { isUniqueViolation } from '@/lib/db-errors'
import { getPlatform, type PlatformId } from '@/lib/platforms'
import { FORMATS, formatOf, postTexts, toPlainText } from '@/lib/formats'
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
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notExists,
  sql
} from 'drizzle-orm'
import {
  assertCanPublish,
  ConnectionError,
  getConnection,
  type PublishingDb,
  markExpired,
  usableAccessToken
} from './connection'
import { canPublishTo, PUBLISHING_PLATFORM_IDS } from './platform'
import {
  type FetchFn,
  PlatformApiError,
  type PlatformConfig,
  type PostImage,
  PostImageError,
  type ProviderContext,
  providerFor,
  type PublishConfigs
} from './provider'
import { postRequested as postRequestedSql } from './publication-queries'
import type {
  PublicationErrorCode,
  PublicationStatus,
  PublicationTrigger
} from './status'

/**
 * Publishing approved posts through each platform's API, by the provider for
 * the post's platform (./provider.ts: LinkedIn, and X through Buffer). Publish
 * now, Schedule and auto-publishing all go through the same steps:
 *
 *   requestPublication   a `scheduled` row, refused unless the post is the
 *                        user's, approved, not yet posted, and the platform
 *                        is connected. The partial unique index allows one live
 *                        publication per post, so a double click or a second
 *                        tab cannot queue it twice.
 *   claim*               scheduled → publishing, a conditional update: only
 *                        one worker (or request) wins a row.
 *   executePublication   checks everything again, then uploads the image and
 *                        creates the post, unless the claim was lost meanwhile
 *                        (a cancel, a disconnect); records the post's URN at
 *                        once.
 *   confirm*             only for a provider that sends the post on after
 *                        answering (Buffer): the row stays 'publishing' with
 *                        the post's id until the provider says it is out.
 *
 * Duplicates: creating a post is not idempotent and member tokens cannot read
 * posts back, so once the create request may have reached the platform the row
 * is never retried by itself (`unknown_outcome`). Only failures where the platform
 * certainly made nothing (refused connections, 429, 503, anything before the
 * create request) are retried, with backoff, up to maxAttempts.
 */

export type PublishDeps = {
  database: PublishingDb
  /** The config of each platform publishing is set up for. */
  configs: PublishConfigs
  /** For the platforms' APIs and OAuth; a stub in tests. */
  fetchFn?: FetchFn
  /** The post's image, or null for none. */
  loadImage?: (draftId: string) => Promise<PostImage | null>
  now?: () => Date
}

export type { PostImage }

/** A publication's metadata, with what this file keeps beyond the schema's type. */
type PublicationMetadata = Publication['metadata'] & {
  /** The requester's zone: the day the post is marked posted on. */
  timezone?: string
}

/** Before the second and the third attempt (maxAttempts is 3). */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000]

/** A publishing row locked longer than this belongs to a process that died. */
export const STALE_LOCK_MS = 10 * 60_000

/**
 * A post handed to a provider that sends it on (Buffer) and not confirmed
 * within this long is given up on as `unknown_outcome`: it may be out.
 */
export const CONFIRM_TIMEOUT_MS = 2 * 60 * 60_000

/** Scheduling further ahead than this is refused (and tokens last about 60 days). */
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
      | 'wrong_platform'
      | 'not_configured'
      | 'not_supported'
      | 'needs_image'
  ) {
    super(message)
    this.name = 'PublishRequestError'
  }
}

const nowOf = (deps: Pick<PublishDeps, 'now'>) => deps.now?.() ?? new Date()

/** A platform's name, for messages. */
const nameOf = (platform: string | null | undefined) => getPlatform(platform).name

/** The config for `platform`, or a refusal when it is not set up here. */
function configFor(deps: PublishDeps, platform: PlatformId): PlatformConfig {
  const config = canPublishTo(platform) ? deps.configs[platform] : undefined
  if (!config) {
    throw new PublishRequestError(
      `Publishing to ${nameOf(platform)} is not set up on this server.`,
      'not_configured'
    )
  }
  return config
}

/** What a provider call runs with, for this connection. */
async function contextFor(
  deps: PublishDeps,
  connection: PlatformConnection
): Promise<ProviderContext> {
  const config = configFor(deps, connection.platform)
  return {
    accessToken: await usableAccessToken(
      deps.database,
      config,
      connection,
      deps.fetchFn,
      nowOf(deps)
    ),
    config,
    fetchFn: deps.fetchFn
  }
}

/**
 * The user's own post, through the identity that owns it (any of theirs). A
 * post of another user's identity is not found, exactly like one that does
 * not exist. Its identity's connection is the one that publishes it.
 */
async function findOwnedDraft(
  database: PublishingDb,
  userId: string,
  draftId: string
) {
  const [draft] = await database
    .select({
      id: postDraftsTable.id,
      accountId: postDraftsTable.accountId,
      platform: postDraftsTable.platform,
      hook: postDraftsTable.hook,
      body: postDraftsTable.body,
      cta: postDraftsTable.cta,
      hashtags: postDraftsTable.hashtags,
      firstComment: postDraftsTable.firstComment,
      status: postDraftsTable.status,
      postedAt: postDraftsTable.postedAt,
      formatId: postDraftsTable.formatId
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
 * The post's texts for the platform, if it can go out: written for a platform
 * and format its provider publishes, approved, not marked posted and each
 * within the platform's length. Checked when it is queued and again when it
 * is published (it may have changed in between). One text, exactly what Copy
 * gives (src/lib/formats); for a provider that publishes threads, every post
 * of a thread in order, then the first comment as the last reply.
 */
function assertPublishable(
  draft: NonNullable<Awaited<ReturnType<typeof findOwnedDraft>>>
): string[] {
  const name = nameOf(draft.platform)
  if (!canPublishTo(draft.platform)) {
    throw new PublishRequestError(
      `${name} posts cannot be published from here.`,
      'wrong_platform'
    )
  }
  const provider = providerFor(draft.platform)
  const format = formatOf(draft.formatId)
  if (!provider.formats.includes(format)) {
    throw new PublishRequestError(
      `This ${FORMATS[format].label} cannot be published from here yet: copy it and post it on ${name}.`,
      'wrong_platform'
    )
  }
  if (draft.status !== 'approved') {
    throw new PublishRequestError(
      'Only an approved post can be published.',
      'not_approved'
    )
  }
  if (draft.postedAt) {
    throw new PublishRequestError(
      `This post is already marked as posted on ${name}.`,
      'already_posted'
    )
  }
  const posts = postTexts(format, draft)
  const reply = provider.threads ? toPlainText(draft.firstComment).trim() : ''
  const texts = reply ? [...posts, reply] : posts
  const tooLong = texts.findIndex(
    text => provider.measure(text) > provider.maxPostLength
  )
  if (tooLong !== -1) {
    const what =
      tooLong >= posts.length
        ? `The ${FORMATS[format].commentLabel.toLowerCase()}`
        : posts.length > 1
          ? `Post ${tooLong + 1} of the thread`
          : 'The post'
    throw new PublishRequestError(
      `${what} is longer than ${name}'s ${provider.maxPostLength} characters${
        FORMATS[format].limits.count === 'x_weighted'
          ? ' (a link counts as 23, an emoji as 2)'
          : ''
      }. Shorten it and try again.`,
      'too_long'
    )
  }
  return texts
}

/** The post's active image, if it has one: what loadPostImage loads. */
const activeImageOf = (
  database: PublishingDb,
  draftId: string | typeof postDraftsTable.id
) =>
  database
    .select({ one: sql`1` })
    .from(postMediaTable)
    .where(
      and(
        eq(postMediaTable.draftId, draftId),
        eq(postMediaTable.status, 'active'),
        isNotNull(postMediaTable.imageUrl)
      )
    )

const needsImageMessage = (name: string) =>
  `${name} posts need an image. Add one to this post, then publish it.`

/**
 * Queues a post to publish at `scheduledAt` (now, for Publish now). Every
 * rule is checked here, and again when it is published. Throws only
 * PublishRequestError for a refusal.
 *
 * When the post's last attempt may already have reached the platform
 * (unknown_outcome), it is refused with `confirm_unknown_outcome` until the
 * user confirms they checked their profile: whether they publish now or
 * schedule it, it could otherwise appear twice.
 */
export async function requestPublication(
  database: PublishingDb,
  input: {
    userId: string
    draftId: string
    trigger: Exclude<PublicationTrigger, 'auto'>
    scheduledAt: Date
    confirmedNotPublished?: boolean
    /** The viewer's IANA zone (validated by the caller): the day it is marked posted on. */
    timezone?: string | null
    /**
     * The platforms set up on this server (PublishDeps.configs); a post for
     * any other is refused. Absent: not checked here (the worker refuses it).
     */
    configuredPlatforms?: readonly string[]
  },
  now = new Date()
): Promise<Publication> {
  const draft = await findOwnedDraft(database, input.userId, input.draftId)
  if (!draft) throw new PublishRequestError('Post not found.', 'not_found')
  assertPublishable(draft)
  const name = nameOf(draft.platform)
  if (
    providerFor(draft.platform).requiresImage &&
    (await activeImageOf(database, draft.id).limit(1)).length === 0
  ) {
    throw new PublishRequestError(needsImageMessage(name), 'needs_image')
  }
  if (
    input.configuredPlatforms &&
    !input.configuredPlatforms.includes(draft.platform)
  ) {
    throw new PublishRequestError(
      `Publishing to ${name} is not set up on this server.`,
      'not_configured'
    )
  }
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
        status: publicationsTable.status,
        errorCode: publicationsTable.errorCode
      })
      .from(publicationsTable)
      .where(eq(publicationsTable.draftId, draft.id))
      .orderBy(desc(publicationsTable.createdAt))
      .limit(1)
    if (last?.status === 'failed' && last.errorCode === 'unknown_outcome') {
      throw new PublishRequestError(
        `The last attempt may have reached ${name}. Check your profile, then confirm it is not there to publish again.`,
        'confirm_unknown_outcome'
      )
    }
  }
  try {
    assertCanPublish(
      await getConnection(database, draft.accountId, draft.platform),
      draft.platform
    )
  } catch (err) {
    throw err instanceof ConnectionError
      ? new PublishRequestError(err.message, err.code)
      : err
  }
  try {
    const [row] = await database
      .insert(publicationsTable)
      .values({
        userId: input.userId,
        accountId: draft.accountId,
        draftId: draft.id,
        platform: draft.platform,
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

/**
 * The connection a publication goes out (or went out) through: its
 * identity's. A row from before identities had their own connections, whose
 * post was deleted since, names no identity: its owner's one connection to
 * that platform stands in, and none when there are several to choose from.
 */
async function connectionFor(
  database: PublishingDb,
  publication: Pick<Publication, 'accountId' | 'userId' | 'platform'>
) {
  if (publication.accountId) {
    return getConnection(database, publication.accountId, publication.platform)
  }
  const rows = await database
    .select()
    .from(platformConnectionsTable)
    .where(
      and(
        eq(platformConnectionsTable.userId, publication.userId),
        eq(platformConnectionsTable.platform, publication.platform)
      )
    )
    .limit(2)
  return rows.length === 1 ? rows[0]! : null
}

/** Calls off a publication that has not started. Null when there is none to cancel. */
export async function cancelPublication(
  database: PublishingDb,
  userId: string,
  publicationId: string,
  now = new Date()
): Promise<Publication | null> {
  const [row] = await database
    .update(publicationsTable)
    .set({ status: 'cancelled', error: null, errorCode: null, updatedAt: now })
    .where(
      and(
        eq(publicationsTable.id, publicationId),
        eq(publicationsTable.userId, userId),
        eq(publicationsTable.status, 'scheduled')
      )
    )
    .returning()
  return row ?? null
}

/** One of the user's publications as it stands now, or null. */
export async function getPublication(
  database: PublishingDb,
  userId: string,
  publicationId: string
): Promise<Publication | null> {
  const [row] = await database
    .select()
    .from(publicationsTable)
    .where(
      and(
        eq(publicationsTable.id, publicationId),
        eq(publicationsTable.userId, userId)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * Deletes a published post from the platform, as the user who published it
 * and through the platform account it was published as. The row stays 'published'
 * with deletedAt set: it is the record of the post, and still the live
 * publication that stops it being published again. One already deleted is
 * returned as it is. Throws PublishRequestError for a refusal, and for
 * the platform's errors.
 */
export async function deletePublishedPost(
  deps: PublishDeps,
  userId: string,
  publicationId: string
): Promise<Publication> {
  const { database } = deps
  const publication = await getPublication(database, userId, publicationId)
  if (
    !publication ||
    publication.status !== 'published' ||
    !publication.externalPostId
  ) {
    throw new PublishRequestError(
      'There is no published post to delete.',
      'not_found'
    )
  }
  if (publication.deletedAt) return publication

  const name = nameOf(publication.platform)
  const provider = providerFor(publication.platform)
  const { deletePost } = provider
  if (!deletePost) {
    throw new PublishRequestError(
      `Posts cannot be deleted from ${name} through TDC AI. Open the post on ${name} and delete it there.`,
      'not_supported'
    )
  }
  try {
    const connection = await connectionFor(database, publication)
    assertCanPublish(connection, publication.platform)
    // Only its author can delete it, and the platform's 404 for anyone else
    // would read as "already deleted".
    if (
      publication.authorUrn &&
      publication.authorUrn !== provider.authorIdOf(connection.memberId)
    ) {
      throw new PublishRequestError(
        `This post was published from a different ${name} account. Connect that account to delete it.`,
        'missing_permission'
      )
    }
    const ctx = await contextFor(deps, connection)
    try {
      await deletePost(ctx, publication.externalPostId)
    } catch (err) {
      // The platform refused the token itself (usableAccessToken expires the rest).
      if (err instanceof PlatformApiError && err.code === 'reauth_required') {
        await markExpired(database, connection, err.message, nowOf(deps)).catch(
          () => {}
        )
      }
      throw err
    }
  } catch (err) {
    if (err instanceof ConnectionError || err instanceof PlatformApiError) {
      throw new PublishRequestError(err.message, err.code)
    }
    throw err
  }

  const now = nowOf(deps)
  const [row] = await database
    .update(publicationsTable)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(publicationsTable.id, publication.id))
    .returning()
  return row ?? { ...publication, deletedAt: now, updatedAt: now }
}

/**
 * Moves one due row from scheduled to publishing, or returns null when
 * another worker got there first, it was cancelled, or it is not due.
 */
export async function claimPublication(
  database: PublishingDb,
  publicationId: string,
  now = new Date()
): Promise<Publication | null> {
  const [row] = await database
    .update(publicationsTable)
    .set({
      status: 'publishing',
      lockedAt: now,
      attempts: sql`${publicationsTable.attempts} + 1`,
      updatedAt: now
    })
    .where(
      and(
        eq(publicationsTable.id, publicationId),
        eq(publicationsTable.status, 'scheduled'),
        lte(publicationsTable.nextAttemptAt, now)
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
export async function loadPostImage(
  database: PublishingDb,
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

/**
 * What a failed attempt records. Messages written for the user are kept;
 * anything else (a bug, a database error) gets a fixed message, and its
 * details go only to the log.
 */
function describeFailure(
  err: unknown,
  postRequested: boolean,
  attemptsLeft: boolean,
  platformName: string
): Failure {
  if (err instanceof PlatformApiError) {
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
  // again cannot help, and it is no fault of the platform's.
  if (err instanceof PostImageError) {
    return { code: 'internal', message: err.message, retryable: false }
  }
  // Our own failure. Before the create request nothing was published, so it
  // can be tried again; after it, the post may exist.
  if (postRequested) {
    return {
      code: 'unknown_outcome',
      message:
        `Publishing stopped after the post was sent to ${platformName}. Check your profile before trying again.`,
      retryable: false
    }
  }
  const NOTHING_SENT = `Publishing failed before anything was sent to ${platformName}.`
  return {
    code: 'internal',
    message: attemptsLeft
      ? `${NOTHING_SENT} It will be tried again.`
      : NOTHING_SENT,
    retryable: true
  }
}

const mergeMetadata = (patch: Record<string, unknown>) =>
  sql`${publicationsTable.metadata} || ${JSON.stringify(patch)}::jsonb`

/**
 * The row while this claim holds it. A cancel, stale-lock recovery or a
 * newer claim (each claim adds an attempt) makes it match nothing, so a
 * worker that lost its row neither posts nor overwrites the outcome.
 */
const heldClaim = (publication: Publication) =>
  and(
    eq(publicationsTable.id, publication.id),
    eq(publicationsTable.status, 'publishing'),
    eq(publicationsTable.attempts, publication.attempts)
  )

/**
 * Every rule again, then what publishing needs. The post may have been
 * rejected, posted by hand or moved to someone else since it was queued.
 * Its owner is the user who queued it, and the connection is that of the
 * post's identity: never another identity's, or another user's.
 */
async function prepare(deps: PublishDeps, publication: Publication) {
  const { database } = deps
  // No draftId: the post was deleted from the app.
  const draft = publication.draftId
    ? await findOwnedDraft(database, publication.userId, publication.draftId)
    : null
  if (!draft) {
    throw new PublishRequestError('The post no longer exists.', 'not_approved')
  }
  const [text = '', ...replies] = assertPublishable(draft)
  // Queued for one platform, it goes out there or not at all.
  if (draft.platform !== publication.platform) {
    throw new PublishRequestError(
      `The post is now written for ${nameOf(draft.platform)}, not ${nameOf(publication.platform)}.`,
      'wrong_platform'
    )
  }
  const provider = providerFor(publication.platform)
  const connection = await getConnection(
    database,
    draft.accountId,
    publication.platform
  )
  assertCanPublish(connection, publication.platform)
  const ctx = await contextFor(deps, connection)
  return {
    draftId: draft.id,
    text,
    // A thread's other posts and the reply, for a provider with `threads`.
    replies,
    // Only where the platform's posts carry one, added after the post.
    comment: provider.addComment ? draft.firstComment?.trim() || null : null,
    // Sent with the post itself (Facebook through Buffer).
    inPostComment: provider.commentInPost
      ? toPlainText(draft.firstComment).trim() || null
      : null,
    connection,
    provider,
    ctx,
    authorUrn: provider.authorIdOf(connection.memberId)
  }
}

/**
 * Publishes a claimed row. Never throws: the outcome is written to the row,
 * which is returned.
 */
export async function executePublication(
  deps: PublishDeps,
  publication: Publication
): Promise<Publication> {
  const { database } = deps
  let postRequested = false
  try {
    const {
      draftId,
      text,
      replies,
      comment,
      inPostComment,
      connection,
      provider,
      ctx,
      authorUrn
    } = await prepare(deps, publication)
    try {
      const image = await (
        deps.loadImage ?? (id => loadPostImage(database, id))
      )(draftId)
      // Removed since it was queued: nothing is sent.
      if (!image && provider.requiresImage) {
        throw new PostImageError(needsImageMessage(provider.platform.name))
      }
      // An uploaded image's URN (LinkedIn), or a link the provider fetches (Buffer).
      const imageUrn = image
        ? await provider.prepareImage(ctx, {
            authorId: authorUrn,
            draftId,
            image,
            now: nowOf(deps)
          })
        : null

      // From here on the post may exist on the platform whatever happens next; the
      // mark lets recovery tell a crash here from one during the image upload.
      // No row marked: the claim was lost (cancelled, say), so stop here.
      const [marked] = await database
        .update(publicationsTable)
        .set({
          connectionId: connection.id,
          authorUrn,
          metadata: mergeMetadata({
            postRequestedAt: nowOf(deps).toISOString(),
            ...(imageUrn && { imageUrn })
          })
        })
        .where(heldClaim(publication))
        .returning({ id: publicationsTable.id })
      if (!marked) {
        const row = await getPublication(
          database,
          publication.userId,
          publication.id
        )
        return row ?? publication
      }
      postRequested = true

      const created = await provider.createPost(ctx, {
        authorId: authorUrn,
        text: provider.toApiText(text),
        ...(replies.length > 0 && { replies: replies.map(provider.toApiText) }),
        ...(inPostComment && { comment: provider.toApiText(inPostComment) }),
        image: imageUrn
          ? { ref: imageUrn, altText: image?.altText ?? null }
          : undefined
      })

      // Handed on, not out yet (Buffer): the row waits, with the post's id,
      // for confirmPendingPublications. Never retried from here.
      if (created.pending) {
        return await recordHandedOn(deps, publication, created.postId)
      }

      // The post is live. Recording that must not turn into a failure: the
      // post's URN is the only proof it exists, and a retry would duplicate it.
      const metadata = publication.metadata as PublicationMetadata
      const { addComment } = provider
      return await recordPublished(deps, publication, {
        draftId,
        postUrn: created.postId,
        postUrl: created.url,
        publishedAt: created.publishedAt,
        zone: zoneOf({
          timezone: metadata.timezone ?? connection.autoPublishTimezone
        }),
        comment,
        addFirstComment: addComment
          ? text => addComment(ctx, created.postId, authorUrn, text)
          : null
      })
    } catch (err) {
      // The platform refused the token itself (usableAccessToken expires the rest).
      if (err instanceof PlatformApiError && err.code === 'reauth_required') {
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
  publication: Publication,
  err: unknown,
  postRequested: boolean
): Promise<Publication> {
  const attemptsLeft = publication.attempts < publication.maxAttempts
  const name = nameOf(publication.platform)
  const failure = describeFailure(err, postRequested, attemptsLeft, name)
  if (failure.code === 'internal' || failure.code === 'unknown_outcome') {
    console.error(`${name} publication ${publication.id} failed:`, err)
  }
  const retry = failure.retryable && attemptsLeft
  const now = nowOf(deps)
  // A larger maxAttempts than 3 keeps the last delay.
  const delay =
    RETRY_DELAYS_MS[publication.attempts - 1] ?? RETRY_DELAYS_MS.at(-1)!
  const patch = failure.httpStatus ? { httpStatus: failure.httpStatus } : {}
  const [row] = await deps.database
    .update(publicationsTable)
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
        ? sql`(${publicationsTable.metadata} - 'postRequestedAt' - 'imageUrn') || ${JSON.stringify(patch)}::jsonb`
        : mergeMetadata(patch),
      updatedAt: now
    })
    .where(heldClaim(publication))
    .returning()
    .catch(updateErr => {
      console.error(
        `Could not record the failure of ${name} publication ${publication.id}:`,
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
 * Records a post the platform has just created, then adds its first comment.
 * Never throws. If the row cannot be marked published even after a retry, the
 * URN is logged (it is the only record of the post) and the row is left
 * 'publishing', so recovery marks it unknown_outcome rather than retrying.
 */
async function recordPublished(
  deps: PublishDeps,
  publication: Publication,
  result: {
    /** The post it is a publication of; null once it was deleted from the app. */
    draftId: string | null
    postUrn: string
    /** The post's link, when the provider gave one (else built from the URN). */
    postUrl?: string | null
    /** When it went out, if the provider says; now otherwise. */
    publishedAt?: Date | null
    /** The zone of the day the post is marked posted on. */
    zone: string
    comment: string | null
    /** Null when the platform's posts carry no first comment. */
    addFirstComment: ((text: string) => Promise<string | null>) | null
    /** Only while the row is still 'publishing' (a confirmation, which may race another). */
    onlyIfPublishing?: boolean
  }
): Promise<Publication> {
  const { database } = deps
  const byId = eq(publicationsTable.id, publication.id)
  const name = nameOf(publication.platform)
  const publishedAt = result.publishedAt ?? nowOf(deps)
  const published = {
    status: 'published' as const,
    externalPostId: result.postUrn,
    publishedAt,
    lockedAt: null,
    error: null,
    errorCode: null,
    ...(result.postUrl && {
      metadata: mergeMetadata({ postUrl: result.postUrl })
    }),
    updatedAt: nowOf(deps)
  }
  // What the caller sees even if the database cannot be written.
  let row: Publication = {
    ...publication,
    ...published,
    metadata: result.postUrl
      ? { ...publication.metadata, postUrl: result.postUrl }
      : publication.metadata
  }

  try {
    const [saved] = await writeWithRetry(() =>
      database
        .update(publicationsTable)
        .set(published)
        .where(
          result.onlyIfPublishing
            ? and(byId, eq(publicationsTable.status, 'publishing'))
            : byId
        )
        .returning()
    )
    if (saved) row = saved
    // Another pass confirmed it first, and did the rest.
    else if (result.onlyIfPublishing) return row
  } catch (err) {
    console.error(
      `${name} publication ${publication.id} IS PUBLISHED as ${result.postUrn}, but it could not be recorded:`,
      err
    )
    return row
  }

  // The post shows as posted on Schedule, on the day it went out. Only a
  // display detail: the publication row above is what prevents a repeat.
  const { draftId } = result
  try {
    if (draftId) {
      await writeWithRetry(() =>
        database
          .update(postDraftsTable)
          .set({
            postedAt: publishedAt,
            plannedFor: sql`coalesce(${postDraftsTable.plannedFor}, ${localDayKey(publishedAt, result.zone)}::date)`,
            updatedAt: nowOf(deps)
          })
          .where(eq(postDraftsTable.id, draftId))
      )
    }
  } catch (err) {
    console.error(
      `Could not mark post ${result.draftId} as posted after publishing it:`,
      err
    )
  }

  // The first comment is extra: if it fails the post is still published,
  // and it is never retried (it could appear twice).
  if (result.comment && result.addFirstComment) {
    let outcome: Record<string, unknown>
    try {
      const commentUrn = await result.addFirstComment(result.comment)
      // The platform may leave the comment's id out.
      outcome = commentUrn ? { commentUrn } : { commentAdded: true }
    } catch (err) {
      const answered =
        err instanceof PlatformApiError && err.status
          ? ` (${name} answered ${err.status})`
          : ''
      outcome = {
        commentError: `The first comment could not be added${answered}.`
      }
    }
    try {
      const [saved] = await database
        .update(publicationsTable)
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
 * Records that the provider took the post and will send it on (Buffer): the
 * row stays 'publishing', now with the post's id, and is confirmed later by
 * confirmPendingPublications. Never throws: if the id cannot be written the
 * row is left as it was, and stale-lock recovery fails it as unknown_outcome
 * (it may be out), never retrying it.
 */
async function recordHandedOn(
  deps: PublishDeps,
  publication: Publication,
  postId: string
): Promise<Publication> {
  const now = nowOf(deps)
  const handedOn = { externalPostId: postId, lockedAt: now, updatedAt: now }
  try {
    const [saved] = await writeWithRetry(() =>
      deps.database
        .update(publicationsTable)
        .set(handedOn)
        .where(heldClaim(publication))
        .returning()
    )
    return saved ?? { ...publication, ...handedOn }
  } catch (err) {
    console.error(
      `${nameOf(publication.platform)} publication ${publication.id} was handed on as ${postId}, but that could not be recorded:`,
      err
    )
    return { ...publication, ...handedOn }
  }
}

/**
 * Rows handed to a provider that sends the post on (Buffer), waiting for it to
 * say the post is out: published (with its link) or failed. A row whose
 * connection is gone, or that is not confirmed within CONFIRM_TIMEOUT_MS,
 * fails as `unknown_outcome`: the post may be out, so it is never retried by
 * itself. A look that fails (an outage) just waits for the next pass.
 */
export async function confirmPendingPublications(
  deps: PublishDeps,
  options: { limit?: number } = {}
): Promise<{ confirmed: number; failed: number }> {
  const { database } = deps
  const now = nowOf(deps)
  const pending = await database
    .select()
    .from(publicationsTable)
    .where(
      and(
        eq(publicationsTable.status, 'publishing'),
        isNotNull(publicationsTable.externalPostId),
        // Not one a request is still waiting on (Publish now's short wait).
        lt(publicationsTable.lockedAt, new Date(now.getTime() - 30_000))
      )
    )
    .orderBy(asc(publicationsTable.lockedAt))
    .limit(options.limit ?? 20)

  let confirmed = 0
  let failed = 0
  for (const publication of pending) {
    const name = nameOf(publication.platform)
    const giveUp = async (error: string, errorCode: PublicationErrorCode) => {
      const [row] = await database
        .update(publicationsTable)
        .set({ status: 'failed', lockedAt: null, error, errorCode, updatedAt: now })
        .where(
          and(
            eq(publicationsTable.id, publication.id),
            eq(publicationsTable.status, 'publishing')
          )
        )
        .returning({ id: publicationsTable.id })
      if (row) failed++
    }
    const timedOut =
      now.getTime() - (publication.lockedAt ?? now).getTime() >
      CONFIRM_TIMEOUT_MS
    try {
      const provider = providerFor(publication.platform)
      const connection = await connectionFor(database, publication)
      const check = provider.checkPost
      if (!check || !connection?.accessToken || connection.status !== 'connected') {
        await giveUp(
          `${name} could not confirm the post: the connection was removed while it was being published. Check your ${name} profile before trying again.`,
          'unknown_outcome'
        )
        continue
      }
      const ctx = await contextFor(deps, connection)
      const state = await check(ctx, publication.externalPostId!)
      if (state.state === 'published') {
        const metadata = publication.metadata as PublicationMetadata
        const row = await recordPublished(deps, publication, {
          draftId: publication.draftId,
          postUrn: publication.externalPostId!,
          postUrl: state.url,
          publishedAt: state.publishedAt,
          zone: zoneOf({
            timezone: metadata.timezone ?? connection.autoPublishTimezone
          }),
          comment: null,
          addFirstComment: null,
          onlyIfPublishing: true
        })
        if (row.status === 'published') confirmed++
      } else if (state.state === 'failed') {
        await giveUp(
          state.error ?? `${name} did not publish the post.`,
          'rejected_by_platform'
        )
      } else if (timedOut) {
        await giveUp(
          `${name} did not confirm the post within ${CONFIRM_TIMEOUT_MS / 3_600_000} hours. Check your ${name} profile and Buffer queue before trying again.`,
          'unknown_outcome'
        )
      }
    } catch (err) {
      // An outage, a refused key: looked at again next pass, until the timeout.
      console.error(
        `Could not confirm ${name} publication ${publication.id}:`,
        err
      )
      // A connection that stopped working, or no answer for too long (an
      // outage, or the platform no longer set up): it may be out, so it is
      // given up as unknown, never retried.
      if (err instanceof ConnectionError || timedOut) {
        await giveUp(
          err instanceof ConnectionError
            ? `${err.message} The post may already be on ${name}: check before trying again.`
            : `${name} did not confirm the post within ${CONFIRM_TIMEOUT_MS / 3_600_000} hours. Check your ${name} profile before trying again.`,
          'unknown_outcome'
        ).catch(() => {})
      }
    }
  }
  return { confirmed, failed }
}

/**
 * Rows left `publishing` by a process that died. One that never sent the
 * create request goes back in the queue (or fails, out of attempts); one that
 * did may be on the platform already, so it fails as `unknown_outcome`. A row
 * already handed on with its post id is confirmPendingPublications' to settle.
 */
export async function recoverStalePublications(
  database: PublishingDb,
  now = new Date()
): Promise<number> {
  const stale = and(
    eq(publicationsTable.status, 'publishing'),
    isNull(publicationsTable.externalPostId),
    lt(
      publicationsTable.lockedAt,
      new Date(now.getTime() - STALE_LOCK_MS)
    )
  )
  let unsure = 0
  // Per platform, so the message names it.
  for (const platform of PUBLISHING_PLATFORM_IDS) {
    const rows = await database
      .update(publicationsTable)
      .set({
        status: 'failed',
        lockedAt: null,
        errorCode: 'unknown_outcome',
        error:
          `Publishing was interrupted after the post was sent to ${nameOf(platform)}. Check your profile before trying again.`,
        updatedAt: now
      })
      .where(
        and(stale, eq(publicationsTable.platform, platform), postRequestedSql)
      )
      .returning({ id: publicationsTable.id })
    unsure += rows.length
  }
  const requeued = await database
    .update(publicationsTable)
    .set({
      status: sql`case when ${publicationsTable.attempts} < ${publicationsTable.maxAttempts} then 'scheduled' else 'failed' end`,
      nextAttemptAt: now,
      lockedAt: null,
      errorCode: 'internal',
      error: 'Publishing was interrupted before the post was sent.',
      updatedAt: now
    })
    .where(and(stale, sql`not (${postRequestedSql})`))
    .returning({ id: publicationsTable.id })
  return unsure + requeued.length
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
  connection: PlatformConnection,
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
  database: PublishingDb,
  now = new Date()
): Promise<number> {
  const connections = await database
    .select()
    .from(platformConnectionsTable)
    .where(
      and(
        eq(platformConnectionsTable.autoPublish, true),
        eq(platformConnectionsTable.status, 'connected')
      )
    )
  let queued = 0
  for (const connection of connections) {
    // One made before its owner had an identity publishes nothing yet.
    const accountId = connection.accountId
    if (!accountId) continue
    const due = dueAutoSlot(connection, now)
    if (!due) continue
    const slotKey = `${connection.autoPublishEnabledAt!.getTime()}:${due.day}`
    if (queuedSlots.get(connection.id) === slotKey) continue
    const { slot } = due

    const drafts = await database
      .select({ id: postDraftsTable.id })
      .from(postDraftsTable)
      .where(
        and(
          // Only its own identity's posts: another identity of the same user
          // publishes through its own connection.
          eq(postDraftsTable.accountId, accountId),
          // Each connection publishes the posts written for its platform, in
          // a format its provider publishes.
          eq(postDraftsTable.platform, connection.platform),
          inArray(
            postDraftsTable.formatId,
            providerFor(connection.platform).formats
          ),
          // Instagram: a post without an image would only fail.
          providerFor(connection.platform).requiresImage
            ? exists(activeImageOf(database, postDraftsTable.id))
            : undefined,
          eq(postDraftsTable.status, 'approved'),
          isNull(postDraftsTable.postedAt),
          eq(postDraftsTable.plannedFor, due.day),
          // Approved, planned and edited before the slot: a post approved or
          // moved onto its day after the time is not published at once.
          lte(postDraftsTable.updatedAt, slot),
          notExists(
            database
              .select({ one: sql`1` })
              .from(publicationsTable)
              .where(eq(publicationsTable.draftId, postDraftsTable.id))
          )
        )
      )
    if (drafts.length > 0) {
      const inserted = await database
        .insert(publicationsTable)
        .values(
          drafts.map(draft => ({
            userId: connection.userId,
            accountId,
            draftId: draft.id,
            platform: connection.platform,
            trigger: 'auto' as const,
            status: 'scheduled' as const,
            scheduledAt: slot,
            nextAttemptAt: now
          }))
        )
        // A post queued meanwhile (Publish now) keeps that one.
        .onConflictDoNothing()
        .returning({ id: publicationsTable.id })
      queued += inserted.length
    }
    queuedSlots.set(connection.id, slotKey)
  }
  return queued
}

/**
 * One pass of the publishing worker: recover interrupted rows, confirm posts
 * a provider sent on, queue auto-publications, then publish what is due,
 * oldest first, one at a time.
 */
export async function runDuePublications(
  deps: PublishDeps,
  options: { limit?: number } = {}
): Promise<{
  recovered: number
  confirmed: number
  queued: number
  published: number
  failed: number
}> {
  const { database } = deps
  const recovered = await recoverStalePublications(database, nowOf(deps))
  const confirmation = await confirmPendingPublications(deps)
  const queued = await queueAutoPublications(database, nowOf(deps))
  const due = await database
    .select({ id: publicationsTable.id })
    .from(publicationsTable)
    .where(
      and(
        eq(publicationsTable.status, 'scheduled'),
        lte(publicationsTable.nextAttemptAt, nowOf(deps))
      )
    )
    .orderBy(asc(publicationsTable.nextAttemptAt))
    .limit(options.limit ?? 10)
  let published = 0
  let failed = 0
  for (const { id } of due) {
    let outcome: Publication
    try {
      const claimed = await claimPublication(database, id, nowOf(deps))
      if (!claimed) continue
      outcome = await executePublication(deps, claimed)
    } catch (err) {
      // One row's failure must not stop the others in this pass.
      console.error(`Publishing pass failed on ${id}:`, err)
      failed++
      continue
    }
    if (outcome.status === 'published') published++
    // Handed on (Buffer): counted when confirmed.
    else if (outcome.status !== 'publishing') failed++
  }
  return {
    recovered,
    confirmed: confirmation.confirmed,
    queued,
    published,
    failed: failed + confirmation.failed
  }
}

/** What the browser sees of a publication. */
export type PublicationSummary = {
  id: string
  platform: PlatformId
  status: PublicationStatus
  trigger: PublicationTrigger
  scheduledAt: string
  nextAttemptAt: string
  publishedAt: string | null
  /** When the user deleted the post from the platform; it is still 'published'. */
  deletedAt: string | null
  postUrl: string | null
  /** The post can be deleted from its platform through the API. */
  canDelete: boolean
  error: string | null
  errorCode: PublicationErrorCode | null
  attempts: number
  commentError: string | null
}

export function toPublicationSummary(
  row: Publication
): PublicationSummary {
  const provider = canPublishTo(row.platform) ? providerFor(row.platform) : null
  return {
    id: row.id,
    platform: row.platform,
    status: row.status,
    trigger: row.trigger,
    scheduledAt: row.scheduledAt.toISOString(),
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    postUrl:
      row.metadata?.postUrl ??
      (row.externalPostId && row.status === 'published'
        ? (provider?.postUrl(row.externalPostId) ?? null)
        : null),
    canDelete: Boolean(provider?.deletePost),
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
  database: PublishingDb,
  draftIds: string[]
): Promise<Map<string, PublicationSummary>> {
  const latest = new Map<string, PublicationSummary>()
  if (draftIds.length === 0) return latest
  // One row per post (its newest), not every attempt it ever had.
  const rows = await database
    .selectDistinctOn([publicationsTable.draftId])
    .from(publicationsTable)
    .where(inArray(publicationsTable.draftId, draftIds))
    .orderBy(
      publicationsTable.draftId,
      desc(publicationsTable.createdAt)
    )
  for (const row of rows) {
    if (row.draftId) latest.set(row.draftId, toPublicationSummary(row))
  }
  return latest
}

/** The newest of the user's publications of one post, or null. */
export async function latestPublicationOf(
  database: PublishingDb,
  userId: string,
  draftId: string
): Promise<PublicationSummary | null> {
  const [row] = await database
    .select()
    .from(publicationsTable)
    .where(
      and(
        eq(publicationsTable.draftId, draftId),
        eq(publicationsTable.userId, userId)
      )
    )
    .orderBy(desc(publicationsTable.createdAt))
    .limit(1)
  return row ? toPublicationSummary(row) : null
}
