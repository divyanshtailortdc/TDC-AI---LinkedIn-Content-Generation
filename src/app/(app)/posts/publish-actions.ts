'use server'

import { db } from '@/db'
import { isUuid } from '@/lib/ids'
import { publishDeps } from '@/lib/publishing/config'
import {
  cancelPublication,
  claimPublication,
  deletePublishedPost,
  executePublication,
  getPublication,
  latestPublicationOf,
  PublishRequestError,
  requestPublication,
  toPublicationSummary,
  type PublicationSummary
} from '@/lib/publishing/engine'
import { isValidTimeZone } from '@/lib/schedule-time'
import { requireUser } from '@/lib/session'
import { PUBLISHING_PLATFORM } from '@/lib/publishing/platform'

/**
 * Publishing an approved post to the signed-in user's own platform account. Only a
 * post id comes from the browser: the owner and the connection are always the
 * signed-in user's, and every rule is checked again on the server.
 *
 * No revalidatePath: in a Server Action it re-renders the whole current route.
 * The controls update from the result, and the browser marks other pages stale.
 */

type Result =
  | { success: true; publication: PublicationSummary }
  | {
      success: false
      error: string
      code?: string
      /** The publication as it now stands, when that is why it failed. */
      publication?: PublicationSummary
    }

type PublishOptions = {
  confirmedNotPublished?: boolean
  /** The viewer's IANA zone: the day the post is marked posted on there. */
  timezone?: string
}

const NOT_SET_UP = `Publishing to ${PUBLISHING_PLATFORM.name} is not set up on this server.`

/** The browser's zone, if it is a real one; otherwise the server decides. */
const zoneOf = (options: PublishOptions) =>
  isValidTimeZone(options.timezone) ? options.timezone : null

function failure(err: unknown, fallback: string): Result {
  if (err instanceof PublishRequestError) {
    return { success: false, error: err.message, code: err.code }
  }
  console.error(fallback, err)
  return { success: false, error: fallback }
}

/**
 * Publishes now, in this request. When the last attempt may already have
 * reached the platform, it is refused with `confirm_unknown_outcome` until the
 * user confirms they checked their profile (see requestPublication).
 */
export async function publishPostNow(
  draftId: string,
  options: PublishOptions = {}
): Promise<Result> {
  const user = await requireUser()
  try {
    if (!isUuid(draftId)) return { success: false, error: 'Post not found.' }
    const deps = publishDeps()
    if (!deps) return { success: false, error: NOT_SET_UP }

    const now = new Date()
    const queued = await requestPublication(
      db,
      {
        userId: user.id,
        draftId,
        trigger: 'manual',
        scheduledAt: now,
        confirmedNotPublished: options.confirmedNotPublished,
        timezone: zoneOf(options)
      },
      now
    )
    // Claimed here; if the worker took it first, it is already publishing,
    // and the row as it now stands says so.
    const claimed = await claimPublication(db, queued.id, now)
    const outcome = claimed
      ? await executePublication(deps, claimed)
      : ((await getPublication(db, user.id, queued.id)) ?? queued)
    return { success: true, publication: toPublicationSummary(outcome) }
  } catch (err) {
    return failure(err, 'The post could not be published. Please try again.')
  }
}

/** Schedules the post for `at` (an ISO instant from the browser, in its own zone). */
export async function schedulePostPublication(
  draftId: string,
  at: string,
  options: PublishOptions = {}
): Promise<Result> {
  const user = await requireUser()
  try {
    if (!isUuid(draftId)) return { success: false, error: 'Post not found.' }
    if (!publishDeps()) return { success: false, error: NOT_SET_UP }
    const scheduledAt = new Date(at)
    if (typeof at !== 'string' || Number.isNaN(scheduledAt.getTime())) {
      return { success: false, error: 'Pick a valid date and time.' }
    }
    const row = await requestPublication(db, {
      userId: user.id,
      draftId,
      trigger: 'scheduled',
      scheduledAt,
      confirmedNotPublished: options.confirmedNotPublished,
      timezone: zoneOf(options)
    })
    return { success: true, publication: toPublicationSummary(row) }
  } catch (err) {
    return failure(err, 'The post could not be scheduled. Please try again.')
  }
}

/** Cancels a scheduled publication of the user's that has not started. */
export async function cancelPostPublication(
  publicationId: string
): Promise<Result> {
  const user = await requireUser()
  try {
    if (!isUuid(publicationId))
      return { success: false, error: 'Publication not found.' }
    const row = await cancelPublication(db, user.id, publicationId)
    if (!row) {
      // Sent back too, so the page shows what it became instead.
      const current = await getPublication(db, user.id, publicationId)
      return {
        success: false,
        error:
          'It can no longer be cancelled: it is already publishing or done.',
        ...(current && { publication: toPublicationSummary(current) })
      }
    }
    return { success: true, publication: toPublicationSummary(row) }
  } catch (err) {
    return failure(
      err,
      'The publication could not be cancelled. Please try again.'
    )
  }
}

/**
 * Deletes the user's published post from the platform. The post stays in the app,
 * and its publication stays as the record (it cannot be published again).
 */
export async function deletePostFromPlatform(
  publicationId: string
): Promise<Result> {
  const user = await requireUser()
  try {
    if (!isUuid(publicationId))
      return { success: false, error: 'Publication not found.' }
    const deps = publishDeps()
    if (!deps) return { success: false, error: NOT_SET_UP }
    const row = await deletePublishedPost(deps, user.id, publicationId)
    return { success: true, publication: toPublicationSummary(row) }
  } catch (err) {
    return failure(
      err,
      `The post could not be deleted from ${PUBLISHING_PLATFORM.name}. Please try again.`
    )
  }
}

/**
 * The post's latest publication as it stands now, for the controls to follow
 * one the worker is publishing or retrying. Null when there is none, or
 * publishing is not set up.
 */
export async function getPostPublication(
  draftId: string
): Promise<PublicationSummary | null> {
  const user = await requireUser()
  if (!isUuid(draftId) || !publishDeps()) return null
  return latestPublicationOf(db, user.id, draftId)
}
