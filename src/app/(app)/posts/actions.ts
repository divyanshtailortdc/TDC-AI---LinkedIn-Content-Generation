'use server'

import { db } from '@/db'
import {
  brandThemesTable,
  feedbackTable,
  ideasTable,
  postCitationsTable,
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
import { linkedInPublishConfig, publishDeps } from '@/lib/linkedin/config'
import {
  cancelPendingPublications,
  hasLivePublication
} from '@/lib/linkedin/publication-queries'
import {
  deletePublishedPost,
  latestPublicationOf
} from '@/lib/linkedin/publishing'
import { REVIEWER_URL_SOURCE } from '@/lib/media/media-source'
import { replaceActiveMedia } from '@/lib/media/replace-media'
import { postCharCount } from '@/lib/post-text'
import { requireUser } from '@/lib/session'
import { and, count, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { loadGenerationContext, loadIdeaContext } from '~/lib/ai/context'
import { buildPostLintOptions } from '~/lib/ai/pipeline/post-lint'
import { runLinter } from '~/lib/lint/run-linter'
import { validateImageUrl } from '~/lib/media/image-input'
import { deleteDraftImages } from '~/lib/media/image-store'
import { createPostMedia } from '~/lib/media/post-media'
import { loadPostsPage } from './posts-data'

/** The next page of the identity's posts, after the post with `cursorId`. */
export async function loadMorePosts(cursorId: string) {
  await requireUser()
  try {
    if (!z.string().uuid().safeParse(cursorId).success) {
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

    // The count and the quality checks describe the text as it now stands. Left
    // as they were, they kept judging the version the AI wrote.
    const charCount = postCharCount({
      hook: newHook,
      body: newBody,
      cta: existing.cta
    })
    let lintFindings = existing.lintFindings ?? []
    try {
      const idea = existing.ideaId
        ? await db.query.ideasTable.findFirst({
            where: eq(ideasTable.id, existing.ideaId)
          })
        : null
      // Checked against the post's own goal, as when it was drafted. Only
      // what the checks read is loaded: a save is not a generation.
      const ctx = idea
        ? await loadIdeaContext(idea, { lintOnly: true })
        : await loadGenerationContext(existing.accountId, {
            goalIds: [],
            lintOnly: true
          })
      const citations = idea
        ? (idea.supportingEvidence?.length ?? 0)
        : ((
            await db
              .select({ total: count() })
              .from(postCitationsTable)
              .where(eq(postCitationsTable.draftId, draftId))
          )[0]?.total ?? 0)
      lintFindings = runLinter(
        buildPostLintOptions(
          ctx,
          idea ?? null,
          {
            hook: newHook,
            body: newBody,
            cta: existing.cta,
            firstComment: newFirstComment,
            hashtags: existing.hashtags
          },
          citations
        )
      )
    } catch (err) {
      // The text is still saved; the earlier checks are kept rather than lost.
      console.error(
        `Could not re-run the quality checks on draft ${draftId}:`,
        err
      )
    }

    await db
      .update(postDraftsTable)
      .set({
        hook: newHook,
        body: newBody,
        firstComment: newFirstComment,
        charCount,
        lintFindings,
        editedBody: newBody,
        updatedAt: new Date()
      })
      .where(eq(postDraftsTable.id, draftId))

    return { success: true, charCount, lintFindings }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to update draft' }
  }
}

export async function approveDraft(draftId: string) {
  await requireUser()
  try {
    const identityId = await requireIdentityId()

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
    const linkedIn = linkedInPublishConfig() !== null

    // Together, so a failed feedback insert cannot leave the post rejected
    // while the client is told the rejection failed.
    await db.transaction(async tx => {
      if (linkedIn) {
        // A rejected post must not stay queued for LinkedIn. Cancelled first:
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
        // A post that is out on LinkedIn (or going out now) cannot be
        // rejected; throwing rolls the cancellation back too.
        if (await hasLivePublication(tx, draftId)) {
          throw new Error(
            'This post is published on LinkedIn and cannot be rejected.'
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
          reasonTags: ['draft_rejected'],
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
 * stops the delete. Its LinkedIn publications stay, without the post, as the
 * record of what was published. With `alsoFromLinkedIn` a published post is
 * deleted from LinkedIn first, and if that fails the post is kept.
 */
export async function deleteDraft(
  draftId: string,
  options: { alsoFromLinkedIn?: boolean } = {}
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
      .select({ id: postDraftsTable.id })
      .from(postDraftsTable)
      .where(owned)
      .limit(1)
    if (!draft) throw new Error('Draft not found')

    let deletedFromLinkedIn = false
    if (options.alsoFromLinkedIn) {
      const deps = publishDeps()
      if (!deps) {
        throw new Error('Publishing to LinkedIn is not set up on this server.')
      }
      const latest = await latestPublicationOf(db, user.id, draftId)
      if (latest?.status === 'published' && !latest.deletedAt) {
        await deletePublishedPost(deps, user.id, latest.id)
        deletedFromLinkedIn = true
      }
    }

    // Only when publishing is set up, like the rest of the app.
    const linkedIn = linkedInPublishConfig() !== null
    await db.transaction(async tx => {
      if (linkedIn) {
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
            'This post is being published to LinkedIn right now. Try again in a moment.'
          )
        }
      }
      await tx.delete(postDraftsTable).where(owned)
    })

    // The rows went with the post; its images in storage go now.
    await deleteDraftImages(draftId)

    return { success: true as const, deletedFromLinkedIn }
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
