'use server'

import { db } from '@/db'
import { requireIdentityId } from '@/lib/identity'
import { PLATFORM_IDS, type PlatformId } from '@/lib/platforms'
import { publishDeps } from '@/lib/publishing/config'
import {
  claimPublication,
  executePublication,
  getPublication,
  PublishRequestError,
  requestPublication,
  toPublicationSummary,
  type PublicationSummary
} from '@/lib/publishing/engine'
import { isValidTimeZone } from '@/lib/schedule-time'
import { requireUser } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { refreshPostChecks } from '~/lib/carousel/service'
import {
  captionOf,
  mediaPostProblem,
  type MediaPostDraft
} from '~/lib/media-upload/drafts'
import { uploadFormatOf } from '~/lib/media-upload/rules'
import {
  createPostsFromUpload,
  MediaUploadError
} from '~/lib/media-upload/service'

/**
 * Create from media, the last step: makes a post per platform from what the
 * user kept, each with its own copy of the uploaded file, then publishes
 * them now, schedules them, or leaves them as drafts to review. Publishing
 * goes through the same engine and checks as Publish on a post.
 */

const text = (max: number) => z.string().max(max).default('')

const postSchema = z.object({
  platform: z.enum(PLATFORM_IDS as unknown as [PlatformId, ...PlatformId[]]),
  hook: text(5000),
  body: text(20_000),
  cta: text(2000),
  hashtags: z.array(z.string().max(100)).max(30).default([]),
  firstComment: text(5000),
  title: text(200),
  altText: text(1000)
})

const inputSchema = z.object({
  uploadId: z.string().max(100),
  fileName: z.string().max(200).nullable().default(null),
  summary: text(2000),
  media: z.object({
    width: z.number().nullable(),
    height: z.number().nullable(),
    durationSeconds: z.number().nullable()
  }),
  kind: z.enum(['image', 'video']),
  posts: z
    .array(postSchema)
    .min(1, 'Pick at least one platform.')
    .max(PLATFORM_IDS.length),
  intent: z.enum(['draft', 'publish', 'schedule']),
  /** An ISO instant, for schedule. */
  scheduledAt: z.string().max(40).optional(),
  timezone: z.string().max(100).optional()
})

export type CreateMediaPostsInput = z.input<typeof inputSchema>

export type CreatedPostResult = {
  platform: PlatformId
  draftId: string
  publication: PublicationSummary | null
  /** Why it was not published or scheduled; the post is kept, to try again. */
  error: string | null
}

type Result =
  | { success: true; results: CreatedPostResult[] }
  | {
      success: false
      error: string
      /** What stops each platform's post, when that is why. */
      problems?: Partial<Record<PlatformId, string>>
    }

export async function createMediaPosts(
  raw: CreateMediaPostsInput
): Promise<Result> {
  const user = await requireUser()
  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid request.'
    }
  }
  const input = parsed.data
  let accountId: string
  try {
    accountId = await requireIdentityId()
  } catch {
    return { success: false, error: 'Set up your identity first.' }
  }

  // One post per platform, in the format media of this kind goes out in.
  const seen = new Set<PlatformId>()
  const drafts: MediaPostDraft[] = []
  for (const post of input.posts) {
    const formatId = uploadFormatOf(input.kind, post.platform)
    if (!formatId || seen.has(post.platform)) continue
    seen.add(post.platform)
    drafts.push({ ...post, formatId })
  }
  if (drafts.length === 0)
    return { success: false, error: 'Pick at least one platform.' }

  // Going out now or later: every post must be ready. A draft only needs text.
  const problems: Partial<Record<PlatformId, string>> = {}
  for (const draft of drafts) {
    const problem =
      input.intent === 'draft'
        ? captionOf(draft)
          ? null
          : 'Write the caption first.'
        : mediaPostProblem(draft)
    if (problem) problems[draft.platform] = problem
  }
  if (Object.keys(problems).length > 0) {
    return {
      success: false,
      error: 'Fix the posts marked below first.',
      problems
    }
  }

  const deps = input.intent === 'draft' ? null : publishDeps()
  if (input.intent !== 'draft' && !deps) {
    return { success: false, error: 'Publishing is not set up on this server.' }
  }
  let scheduledAt: Date | null = null
  if (input.intent === 'schedule') {
    scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      return { success: false, error: 'Pick a valid date and time.' }
    }
    if (scheduledAt.getTime() - Date.now() < 60_000) {
      return {
        success: false,
        error: 'Pick a time at least a minute from now.'
      }
    }
  }
  const timezone = isValidTimeZone(input.timezone) ? input.timezone : null

  let created
  try {
    created = await createPostsFromUpload(accountId, {
      uploadId: input.uploadId,
      fileName: input.fileName,
      summary: input.summary,
      posts: drafts,
      approved: input.intent !== 'draft',
      media: input.media
    })
  } catch (err) {
    if (err instanceof MediaUploadError)
      return { success: false, error: err.message }
    console.error('Could not create posts from uploaded media:', err)
    return {
      success: false,
      error: 'The posts could not be created. Please try again.'
    }
  }

  // The checks the posts page shows; a failure only leaves them unchecked.
  await Promise.all(
    created.map(({ draftId }) =>
      refreshPostChecks(draftId).catch(err =>
        console.warn(`Could not check post ${draftId}:`, err)
      )
    )
  )

  const results: CreatedPostResult[] = await Promise.all(
    created.map(async ({ platform, draftId }): Promise<CreatedPostResult> => {
      if (!deps) return { platform, draftId, publication: null, error: null }
      try {
        const now = new Date()
        const queued = await requestPublication(
          db,
          {
            userId: user.id,
            draftId,
            trigger: scheduledAt ? 'scheduled' : 'manual',
            scheduledAt: scheduledAt ?? now,
            timezone,
            configuredPlatforms: Object.keys(deps.configs)
          },
          now
        )
        if (scheduledAt) {
          return {
            platform,
            draftId,
            publication: toPublicationSummary(queued),
            error: null
          }
        }
        // Published in this request, as Publish now on a post is.
        const claimed = await claimPublication(db, queued.id, now)
        const outcome = claimed
          ? await executePublication(deps, claimed)
          : ((await getPublication(db, user.id, queued.id)) ?? queued)
        const summary = toPublicationSummary(outcome)
        return {
          platform,
          draftId,
          publication: summary,
          error:
            outcome.status === 'failed'
              ? (outcome.error ?? 'Publishing failed.')
              : null
        }
      } catch (err) {
        if (!(err instanceof PublishRequestError)) {
          console.error(`Could not publish post ${draftId}:`, err)
        }
        return {
          platform,
          draftId,
          publication: null,
          error:
            err instanceof PublishRequestError
              ? err.message
              : 'The post was saved but could not be published. Open it to try again.'
        }
      }
    })
  )

  revalidatePath('/posts')
  return { success: true, results }
}
