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
import { deleteDraftImages, viewableImageUrl } from '~/lib/media/image-store'
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
      // Checked against the post's own goal, as when it was drafted.
      const ctx = idea
        ? await loadIdeaContext(idea)
        : await loadGenerationContext(existing.accountId, { goalIds: [] })
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

    revalidatePath('/posts')
    revalidatePath(`/posts/${draftId}`)
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

    revalidatePath('/posts')
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

    // Together, so a failed feedback insert cannot leave the post rejected
    // while the client is told the rejection failed.
    await db.transaction(async tx => {
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

    revalidatePath('/posts')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to reject draft' }
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
      revalidatePath('/posts')
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

    revalidatePath('/posts')
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

    revalidatePath('/posts')
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

/**
 * Loads one media image on demand.
 *
 * The review queue lists every draft, but only the open post shows its image.
 * Shipping each base64 data URL with the page put megabytes into the initial
 * payload, so the bytes are fetched when a post is actually opened.
 */
export async function fetchPostMediaImage(mediaId: string) {
  await requireUser()
  try {
    const identityId = await requireIdentityId()

    // Joined to the draft so one account cannot read another's images by id.
    const [media] = await db
      .select({ id: postMediaTable.id, imageUrl: postMediaTable.imageUrl })
      .from(postMediaTable)
      .innerJoin(
        postDraftsTable,
        eq(postMediaTable.draftId, postDraftsTable.id)
      )
      .where(
        and(
          eq(postMediaTable.id, mediaId),
          eq(postDraftsTable.accountId, identityId)
        )
      )
      .limit(1)

    if (!media?.imageUrl) {
      return { success: false as const, error: 'Image not found' }
    }

    return {
      success: true as const,
      imageUrl: await viewableImageUrl(media.imageUrl)
    }
  } catch (err: any) {
    console.error('Error loading post media image:', err)
    return {
      success: false as const,
      error: err?.message || 'Failed to load image'
    }
  }
}
