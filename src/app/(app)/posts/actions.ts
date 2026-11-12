'use server'

import { db } from '@/db'
import {
  brandThemesTable,
  feedbackTable,
  postDraftsTable,
  postMediaTable
} from '@/db/schema'
import {
  BRAND_THEME_PATH,
  BrandThemePayloadSchema,
  type BackgroundPattern
} from '@/lib/brand/theme'
import { requireIdentityId } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import { isPublishingConfigured, publishDeps } from '@/lib/publishing/config'
import { getPlatform } from '@/lib/platforms'
import {
  cancelPendingPublications,
  hasLivePublication
} from '@/lib/publishing/publication-queries'
import {
  deletePublishedPost,
  latestPublicationOf
} from '@/lib/publishing/engine'
import { REVIEWER_URL_SOURCE } from '@/lib/media/media-source'
import { replaceActiveMedia } from '@/lib/media/replace-media'
import {
  FORMATS,
  formatOf,
  isCreatableFormat,
  isFormatId,
  overLimitMessage
} from '@/lib/formats'
import { loadChannels } from '@/lib/channels'
import { requireUser } from '@/lib/session'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { recheckPostText } from '~/lib/ai/pipeline/post-recheck'
import { listRevisions, lockPost, saveRevision } from '@/lib/post-revisions'
import {
  draftAdditionalFormat,
  regenerateDraft,
  restoreRevision
} from '~/lib/ai/pipeline/drafting-run'
import { validateImageUrl } from '~/lib/media/image-input'
import { deleteDraftImages } from '~/lib/media/image-store'
import { createPostMedia } from '~/lib/media/post-media'
import { loadPostsPage } from './posts-data'

/**
 * The next page of the identity's posts, after the post with `cursorId`, or
 * the newest page when it is null (the list lost its place, e.g. the post it
 * named was deleted; it skips the posts it already has).
 */
export async function loadMorePosts(cursorId: string | null) {
  await requireUser()
  try {
    if (cursorId !== null && !z.string().uuid().safeParse(cursorId).success) {
      return { success: false as const, error: 'Invalid page reference.' }
    }
    const accountId = await requireIdentityId()
    const { posts, nextCursor } = await loadPostsPage(accountId, { cursorId })
    return { success: true as const, posts, nextCursor }
  } catch (err: any) {
    return {
      success: false as const,
      error: err.message || 'Could not load more posts.'
    }
  }
}

export async function updateDraft(
  draftId: string,
  payload: {
    hook?: string
    body?: string
    firstComment?: string
    /** A video's caption and (YouTube) title. */
    caption?: string
    title?: string
  }
) {
  await requireUser()
  try {
    const identityId = await requireIdentityId()

    const existing = await db.query.postDraftsTable.findFirst({
      where: and(
        eq(postDraftsTable.id, draftId),
        eq(postDraftsTable.accountId, identityId)
      )
    })

    if (!existing) throw new Error('Draft not found')

    const newHook = payload.hook ?? existing.hook
    const newBody = payload.body ?? existing.body
    const newFirstComment =
      payload.firstComment !== undefined
        ? payload.firstComment
        : existing.firstComment

    // A video keeps its caption and title beside its shots.
    const newPayload =
      typeof payload.caption === 'string' || typeof payload.title === 'string'
        ? {
            ...(existing.payload ?? {}),
            ...(typeof payload.caption === 'string'
              ? { caption: payload.caption.slice(0, 5000) }
              : {}),
            ...(typeof payload.title === 'string'
              ? { title: payload.title.slice(0, 200) }
              : {})
          }
        : (existing.payload ?? null)

    const { charCount, lintFindings } = await recheckPostText(existing, {
      hook: newHook,
      body: newBody,
      cta: existing.cta,
      firstComment: newFirstComment,
      hashtags: existing.hashtags,
      payload: newPayload
    })

    // The version this edit replaces is kept, so it can be restored.
    const versionSaved = await db.transaction(async tx => {
      const current = await lockPost(tx, draftId)
      if (!current) throw new Error('Draft not found')
      const saved = await saveRevision(tx, current, 'user_edit', {
        next: {
          hook: newHook,
          body: newBody,
          firstComment: newFirstComment,
          payload: newPayload
        }
      })
      await tx
        .update(postDraftsTable)
        .set({
          hook: newHook,
          body: newBody,
          firstComment: newFirstComment,
          payload: newPayload,
          charCount,
          lintFindings,
          editedBody: newBody,
          updatedAt: new Date()
        })
        .where(eq(postDraftsTable.id, draftId))
      return saved
    })

    return { success: true, charCount, lintFindings, versionSaved }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to update draft' }
  }
}

/**
 * Writes another platform's version of a post's idea ("Add a version" on the
 * review screen) and returns it, ready to show. Takes about as long as
 * drafting one post; only formats the identity has turned on are offered.
 */
export async function addPostVersion(draftId: string, formatId: string) {
  await requireUser()
  try {
    if (!z.string().uuid().safeParse(draftId).success || !isFormatId(formatId)) {
      throw new Error('Choose a platform to write a version for.')
    }
    const accountId = await requireIdentityId()
    const source = await db.query.postDraftsTable.findFirst({
      where: and(
        eq(postDraftsTable.id, draftId),
        eq(postDraftsTable.accountId, accountId)
      ),
      columns: { ideaId: true }
    })
    if (!source) throw new Error('Draft not found')
    if (!source.ideaId) {
      throw new Error('This post has no idea behind it to write another version from.')
    }

    if (!isCreatableFormat(formatId)) {
      throw new Error(`${FORMATS[formatId].label}s cannot be created here.`)
    }
    if (!(await loadChannels(accountId)).enabledFormats.includes(formatId)) {
      throw new Error(
        `Turn on ${FORMATS[formatId].label}s under Identity → Preferences first.`
      )
    }

    const { draftId: newId } = await draftAdditionalFormat(
      accountId,
      source.ideaId,
      formatId
    )
    const { posts } = await loadPostsPage(accountId, { ids: [newId] })
    revalidatePath('/posts')
    return { success: true as const, post: posts[0] ?? null }
  } catch (err: any) {
    return {
      success: false as const,
      error: err.message || 'The new version could not be written.'
    }
  }
}

const MAX_INSTRUCTION_CHARS = 1000

/**
 * Writes a new version of a post, with what the reviewer wants changed, and
 * returns it. The version it replaces is kept under Earlier versions.
 */
export async function regeneratePost(draftId: string, instruction?: string | null) {
  await requireUser()
  try {
    if (!z.string().uuid().safeParse(draftId).success) {
      throw new Error('Draft not found')
    }
    const wanted = typeof instruction === 'string' ? instruction.trim() : ''
    if (wanted.length > MAX_INSTRUCTION_CHARS) {
      throw new Error(
        `Keep the instruction under ${MAX_INSTRUCTION_CHARS} characters.`
      )
    }
    const accountId = await requireIdentityId()
    await regenerateDraft(accountId, draftId, wanted || null)
    const { posts } = await loadPostsPage(accountId, { ids: [draftId] })
    revalidatePath('/posts')
    return { success: true as const, post: posts[0] ?? null }
  } catch (err: any) {
    return {
      success: false as const,
      error: err.message || 'The new version could not be written.'
    }
  }
}

/** A post's earlier versions, newest first, for its Earlier versions list. */
export async function loadPostVersions(draftId: string) {
  await requireUser()
  try {
    if (!z.string().uuid().safeParse(draftId).success) {
      throw new Error('Draft not found')
    }
    const accountId = await requireIdentityId()
    const owned = await db.query.postDraftsTable.findFirst({
      where: and(
        eq(postDraftsTable.id, draftId),
        eq(postDraftsTable.accountId, accountId)
      ),
      columns: { id: true }
    })
    if (!owned) throw new Error('Draft not found')
    const rows = await listRevisions(db, draftId)
    return {
      success: true as const,
      versions: rows.map(r => ({
        id: r.id,
        number: r.number,
        replacedBy: r.replacedBy,
        instruction: r.instruction,
        hook: r.hook,
        body: r.body,
        charCount: r.charCount,
        createdAt: r.createdAt
      }))
    }
  } catch (err: any) {
    return {
      success: false as const,
      error: err.message || 'Could not load earlier versions.'
    }
  }
}

/** Puts an earlier version back and returns the post as it now stands. */
export async function restorePostVersion(draftId: string, revisionId: string) {
  await requireUser()
  try {
    if (
      !z.string().uuid().safeParse(draftId).success ||
      !z.string().uuid().safeParse(revisionId).success
    ) {
      throw new Error('That version no longer exists.')
    }
    const accountId = await requireIdentityId()
    await restoreRevision(accountId, draftId, revisionId)
    const { posts } = await loadPostsPage(accountId, { ids: [draftId] })
    revalidatePath('/posts')
    return { success: true as const, post: posts[0] ?? null }
  } catch (err: any) {
    return {
      success: false as const,
      error: err.message || 'The version could not be restored.'
    }
  }
}

export async function approveDraft(draftId: string) {
  await requireUser()
  try {
    const identityId = await requireIdentityId()

    // An X post is published as it is approved: one over X's limit (each
    // post of a thread, and the reply) could never go out.
    const draft = await db.query.postDraftsTable.findFirst({
      where: and(
        eq(postDraftsTable.id, draftId),
        eq(postDraftsTable.accountId, identityId)
      ),
      columns: {
        hook: true,
        body: true,
        cta: true,
        hashtags: true,
        payload: true,
        firstComment: true,
        formatId: true
      }
    })
    if (!draft) throw new Error('Draft not found')
    const format = formatOf(draft.formatId)
    if (FORMATS[format].platform === 'x') {
      const problem = overLimitMessage(format, draft)
      if (problem) throw new Error(problem)
    }

    const [approved] = await db
      .update(postDraftsTable)
      .set({
        status: 'approved',
        approvedAt: new Date(),
        updatedAt: new Date()
      })
      .where(
        and(
          eq(postDraftsTable.id, draftId),
          eq(postDraftsTable.accountId, identityId)
        )
      )
      .returning({ id: postDraftsTable.id })

    // An update that matched nothing is not an approval.
    if (!approved) throw new Error('Draft not found')

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to approve draft' }
  }
}

export async function rejectDraft(draftId: string, reason?: string) {
  await requireUser()
  try {
    const identityId = await requireIdentityId()

    const draft = await db.query.postDraftsTable.findFirst({
      where: and(
        eq(postDraftsTable.id, draftId),
        eq(postDraftsTable.accountId, identityId)
      )
    })

    if (!draft) throw new Error('Draft not found')

    // Only when publishing is set up, like the rest of the app.
    const publishingOn = isPublishingConfigured()

    // Together, so a failed feedback insert cannot leave the post rejected
    // while the client is told the rejection failed.
    await db.transaction(async tx => {
      if (publishingOn) {
        // A rejected post must not stay queued to publish. Cancelled first:
        // that locks the queued rows, so a worker claiming one now either
        // already moved it (and it is caught below) or finds it cancelled.
        await cancelPendingPublications(
          tx,
          { draftId },
          {
            message: 'Cancelled because the post was rejected.',
            code: 'not_approved'
          }
        )
        // A post that is out on its platform (or going out now) cannot be
        // rejected; throwing rolls the cancellation back too.
        if (await hasLivePublication(tx, draftId)) {
          throw new Error(
            `This post is published on ${getPlatform(draft.platform).name} and cannot be rejected.`
          )
        }
      }

      await tx
        .update(postDraftsTable)
        .set({
          status: 'rejected',
          updatedAt: new Date()
        })
        .where(eq(postDraftsTable.id, draftId))

      if (reason) {
        await tx.insert(feedbackTable).values({
          accountId: draft.accountId,
          draftId: draft.id,
          verdict: 'rejected',
          reasonText: reason,
          // The format, so a complaint about an X post's length can later be
          // kept to X posts.
          reasonTags: ['draft_rejected', `format:${formatOf(draft.formatId)}`],
          originalBody: draft.body
        })
      }
    })

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to reject draft' }
  }
}

/**
 * Takes a post out of the Posts queue (it shows under the Hidden filter), or
 * puts it back. Nothing else about it changes: a scheduled publication still
 * goes out.
 */
export async function setDraftHidden(draftId: string, hidden: boolean) {
  await requireUser()
  try {
    if (!isUuid(draftId)) throw new Error('Draft not found')
    const identityId = await requireIdentityId()
    const [row] = await db
      .update(postDraftsTable)
      .set({ hiddenAt: hidden ? new Date() : null, updatedAt: new Date() })
      .where(
        and(
          eq(postDraftsTable.id, draftId),
          eq(postDraftsTable.accountId, identityId)
        )
      )
      .returning({ hiddenAt: postDraftsTable.hiddenAt })
    if (!row) throw new Error('Draft not found')
    return {
      success: true as const,
      hiddenAt: row.hiddenAt?.toISOString() ?? null
    }
  } catch (err: any) {
    return {
      success: false as const,
      error:
        err.message ||
        (hidden ? 'Failed to hide the post' : 'Failed to show the post')
    }
  }
}

/**
 * Deletes a post from the app for good, with its alternates, sources and
 * images. A scheduled publication is called off, and one going out right now
 * stops the delete. Its publications stay, without the post, as the
 * record of what was published. With `alsoFromPlatform` a published post is
 * deleted from the platform first, and if that fails the post is kept.
 */
export async function deleteDraft(
  draftId: string,
  options: { alsoFromPlatform?: boolean } = {}
) {
  const user = await requireUser()
  try {
    if (!isUuid(draftId)) throw new Error('Draft not found')
    const identityId = await requireIdentityId()
    const owned = and(
      eq(postDraftsTable.id, draftId),
      eq(postDraftsTable.accountId, identityId)
    )
    const [draft] = await db
      .select({ id: postDraftsTable.id, platform: postDraftsTable.platform })
      .from(postDraftsTable)
      .where(owned)
      .limit(1)
    if (!draft) throw new Error('Draft not found')
    const platformName = getPlatform(draft.platform).name

    let deletedFromPlatform = false
    if (options.alsoFromPlatform) {
      const deps = publishDeps()
      if (!deps) {
        throw new Error(
          `Publishing to ${platformName} is not set up on this server.`
        )
      }
      const latest = await latestPublicationOf(db, user.id, draftId)
      // A platform whose API cannot delete posts (X through Buffer) is left alone.
      if (latest?.status === 'published' && !latest.deletedAt && latest.canDelete) {
        await deletePublishedPost(deps, user.id, latest.id)
        deletedFromPlatform = true
      }
    }

    // Only when publishing is set up, like the rest of the app.
    const publishingOn = isPublishingConfigured()
    await db.transaction(async tx => {
      if (publishingOn) {
        // Called off first, as in rejectDraft, so a worker claiming one now
        // either already moved it (caught below) or finds it cancelled. One
        // in flight whose post was not sent yet is stopped too.
        await cancelPendingPublications(
          tx,
          { draftId },
          {
            message: 'Cancelled because the post was deleted.',
            code: 'not_approved'
          },
          { includeUnsentInFlight: true }
        )
        if (await hasLivePublication(tx, draftId, ['publishing'])) {
          throw new Error(
            `This post is being published to ${platformName} right now. Try again in a moment.`
          )
        }
      }
      await tx.delete(postDraftsTable).where(owned)
    })

    // The rows went with the post; its images in storage go now.
    await deleteDraftImages(draftId)

    return { success: true as const, deletedFromPlatform }
  } catch (err: any) {
    return {
      success: false as const,
      error: err.message || 'Failed to delete the post'
    }
  }
}

export async function updatePostMediaAction(
  draftId: string,
  payload: {
    mode: 'ai_generated' | 'stock' | 'none'
    imageUrl?: string
    altText?: string
    promptOrQuery?: string
  }
) {
  await requireUser()
  try {
    const identityId = await requireIdentityId()

    // The client disables Apply for bad URLs, but this action is callable directly.
    if (payload.mode !== 'none' && payload.imageUrl) {
      const urlError = validateImageUrl(payload.imageUrl)
      if (urlError) throw new Error(urlError)
    }

    const existingDraft = await db.query.postDraftsTable.findFirst({
      where: and(
        eq(postDraftsTable.id, draftId),
        eq(postDraftsTable.accountId, identityId)
      )
    })
    if (!existingDraft) throw new Error('Post draft not found')

    if (payload.mode === 'none' || !payload.imageUrl) {
      await db.delete(postMediaTable).where(eq(postMediaTable.draftId, draftId))
      await deleteDraftImages(draftId)
      return { success: true, media: null }
    }

    // A new version, so earlier ones are kept (see replaceActiveMedia).
    const imageUrl = payload.imageUrl
    const media = await replaceActiveMedia(db, {
      draftId,
      mode: payload.mode,
      imageUrl,
      altText: payload.altText,
      promptOrQuery: payload.promptOrQuery,
      source: REVIEWER_URL_SOURCE
    })

    return {
      success: true,
      media: {
        id: media.id,
        version: media.version,
        status: media.status,
        mode: payload.mode,
        imageUrl,
        altText: payload.altText,
        promptOrQuery: payload.promptOrQuery,
        source: REVIEWER_URL_SOURCE,
        fallbackApplied: false,
        regenerationAttempt: media.regenerationAttempt
      }
    }
  } catch (err: any) {
    console.error('Error updating post media:', err)
    return { success: false, error: err?.message || 'Failed to update media' }
  }
}

export async function removePostMediaAction(draftId: string) {
  await requireUser()
  try {
    const identityId = await requireIdentityId()

    const draft = await db.query.postDraftsTable.findFirst({
      where: and(
        eq(postDraftsTable.id, draftId),
        eq(postDraftsTable.accountId, identityId)
      )
    })
    if (!draft) throw new Error('Post draft not found')

    await db.delete(postMediaTable).where(eq(postMediaTable.draftId, draftId))
    await deleteDraftImages(draftId)

    return { success: true }
  } catch (err: any) {
    console.error('Error removing post media:', err)
    return { success: false, error: err?.message || 'Failed to remove media' }
  }
}

/**
 * Makes a new image for a post, from its text, or from a stock query the
 * reviewer typed. The first image and every regeneration go through here:
 * each one sees all the post's earlier images and must differ from them.
 * (A reference image goes through the media route, which can be stopped.)
 */
export async function regeneratePostMediaAction(
  draftId: string,
  options?: {
    mode?: 'ai_generated' | 'stock'
    customPrompt?: string
    rejectionReason?: string
  }
) {
  await requireUser()
  try {
    const outcome = await createPostMedia({
      draftId,
      accountId: await requireIdentityId(),
      mode: options?.mode,
      customPrompt: options?.customPrompt,
      rejectionReason: options?.rejectionReason
    })
    if (outcome.status === 'created') {
      return { success: true as const, media: outcome.media }
    }
    return {
      success: false as const,
      error:
        outcome.status === 'failed'
          ? outcome.error
          : outcome.status === 'draft_not_found'
            ? 'Post draft not found'
            : 'Image generation was stopped.'
    }
  } catch (err: any) {
    console.error('Error regenerating post media:', err)
    return {
      success: false as const,
      error: err?.message || 'Failed to regenerate media'
    }
  }
}

// The Brand Theme's own rules for these two fields, so they cannot drift apart.
const ImageSettingsSchema = BrandThemePayloadSchema.pick({
  backgroundPattern: true,
  footerText: true
})

/**
 * Saves the background pattern and the website shown on every new image,
 * from the image panel. Only these two columns are written, so the rest of
 * the brand theme stays as the Brand Theme page saved it.
 */
export async function saveImageSettings(settings: {
  backgroundPattern: BackgroundPattern
  footerText: string | null
}) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const parsed = ImageSettingsSchema.safeParse(settings)
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues[0]?.message || 'Invalid image settings.'
      }
    }

    const columns = { ...parsed.data, updatedAt: new Date() }
    // One row per identity (UNIQUE account_id): a second save updates it.
    await db
      .insert(brandThemesTable)
      .values({ accountId, ...columns })
      .onConflictDoUpdate({ target: brandThemesTable.accountId, set: columns })

    revalidatePath(BRAND_THEME_PATH)
    return { success: true as const }
  } catch (err: any) {
    return {
      success: false as const,
      error: err?.message || 'Could not save the image settings.'
    }
  }
}
