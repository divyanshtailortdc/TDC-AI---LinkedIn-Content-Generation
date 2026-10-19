'use server'

import { db } from '@/db'
import {
  feedbackTable,
  ideasTable,
  postCitationsTable,
  postDraftsTable,
  postMediaTable
} from '@/db/schema'
import { requireIdentityId } from '@/lib/identity'
import {
  REVIEWER_SEARCH_SOURCE,
  REVIEWER_URL_SOURCE
} from '@/lib/media/media-source'
import { replaceActiveMedia } from '@/lib/media/replace-media'
import { postCharCount } from '@/lib/post-text'
import { requireUser } from '@/lib/session'
import { and, count, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { loadGenerationContext, renderMediaContext } from '~/lib/ai/context'
import { buildPostLintOptions } from '~/lib/ai/pipeline/post-lint'
import { recordReviewMediaSpend } from '~/lib/ai/run-accounting'
import { runLinter } from '~/lib/lint/run-linter'
import { createMediaPlan, regenerateMediaPlan } from '~/lib/media'
import { validateImageUrl } from '~/lib/media/image-input'
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
      const ctx = await loadGenerationContext(existing.accountId, {
        goalId: idea?.goalId
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

    revalidatePath('/posts')
    return { success: true }
  } catch (err: any) {
    console.error('Error removing post media:', err)
    return { success: false, error: err?.message || 'Failed to remove media' }
  }
}

/**
 * The account name lets the brief allow the account's own brand; the context
 * (field and audience) keeps the image in their world.
 */
async function loadMediaSettings(accountId: string) {
  const ctx = await loadGenerationContext(accountId)
  return {
    accountName: ctx.account.name,
    accountContext: renderMediaContext(ctx)
  }
}

export async function generatePostMediaAction(
  draftId: string,
  options?: {
    mode?: 'ai_generated' | 'stock'
    customPrompt?: string
  }
) {
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

    let topic: string | undefined = undefined
    let coreArgument: string | undefined = undefined
    let thesis: string | undefined = undefined
    let evidence: any[] = []

    if (draft.ideaId) {
      const idea = await db.query.ideasTable.findFirst({
        where: eq(ideasTable.id, draft.ideaId)
      })
      if (idea) {
        topic = idea.pillar || idea.title || undefined
        coreArgument = idea.coreArgument || undefined
        thesis = idea.thesis || idea.coreArgument || undefined
        evidence = (idea.supportingEvidence as any[]) || []
      }
    }

    const mode = options?.mode || 'ai_generated'
    // The post text already carries the hook; only the reviewer's own words add direction.
    const brief = options?.customPrompt?.trim() || undefined
    const fullPostContent = `${draft.hook}\n\n${draft.body}\n\n${draft.cta || ''}`

    const mediaSettings = await loadMediaSettings(draft.accountId)

    const mediaPlan = await createMediaPlan({
      mode,
      brief,
      topic,
      hook: draft.hook,
      postText: fullPostContent,
      thesis: thesis || coreArgument || topic,
      coreArgument,
      evidence,
      ...mediaSettings
    })

    // Charged to the post's run whether or not an image came back.
    await recordReviewMediaSpend(draftId, mediaPlan.usage, {
      summary: `Media plan (${mediaPlan.mode}) (post review)`,
      error: mediaPlan.imageUrl ? null : mediaPlan.error || 'No image produced'
    })

    if (mediaPlan.mode !== 'none' && mediaPlan.imageUrl) {
      const [insertedMedia] = await db
        .insert(postMediaTable)
        .values({
          draftId,
          version: 1,
          status: 'active',
          regenerationAttempt: 0,
          mode: mediaPlan.mode,
          imageUrl: mediaPlan.imageUrl,
          altText: mediaPlan.altText || null,
          promptOrQuery: mediaPlan.promptOrQuery || null,
          metadata: {
            sourcePageUrl: mediaPlan.sourcePageUrl,
            fallbackApplied: mediaPlan.fallbackApplied || false,
            visualType: mediaPlan.visualType,
            relevanceScore: mediaPlan.relevanceScore,
            relevanceExplanation: mediaPlan.relevanceExplanation,
            alignedConcepts: mediaPlan.alignedConcepts,
            textOverlay: mediaPlan.textOverlay,
            mediaBrief: mediaPlan.mediaBrief,
            // Generated outside a run, so its spend is recorded here instead.
            usage: mediaPlan.usage
          }
        })
        .returning()

      if (!insertedMedia)
        throw new Error('Failed to insert initial media record')

      revalidatePath('/posts')
      revalidatePath(`/posts/${draftId}`)
      return {
        success: true,
        media: {
          id: insertedMedia.id,
          version: insertedMedia.version,
          status: insertedMedia.status,
          mode: mediaPlan.mode,
          imageUrl: mediaPlan.imageUrl,
          altText: mediaPlan.altText,
          promptOrQuery: mediaPlan.promptOrQuery,
          fallbackApplied: mediaPlan.fallbackApplied,
          visualType: mediaPlan.visualType,
          relevanceScore: mediaPlan.relevanceScore
        }
      }
    }

    return {
      success: false,
      error: mediaPlan.error || 'Could not generate a visual for this post'
    }
  } catch (err: any) {
    console.error('Error generating post media:', err)
    return {
      success: false,
      error: err?.message || 'Failed to generate media'
    }
  }
}

export async function regeneratePostMediaAction(
  draftId: string,
  options?: {
    mode?: 'ai_generated' | 'stock'
    customPrompt?: string
    rejectionReason?: string
    previousMediaId?: string
  }
) {
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

    let topic: string | undefined = undefined
    let coreArgument: string | undefined = undefined
    let thesis: string | undefined = undefined
    let evidence: any[] = []

    if (draft.ideaId) {
      const idea = await db.query.ideasTable.findFirst({
        where: eq(ideasTable.id, draft.ideaId)
      })
      if (idea) {
        topic = idea.pillar || idea.title || undefined
        coreArgument = idea.coreArgument || undefined
        thesis = idea.thesis || idea.coreArgument || undefined
        evidence = (idea.supportingEvidence as any[]) || []
      }
    }

    // 1. Fetch the existing media record for negative context
    const existingMedia =
      (await db.query.postMediaTable.findFirst({
        where: and(
          eq(postMediaTable.draftId, draftId),
          eq(postMediaTable.status, 'active')
        ),
        orderBy: desc(postMediaTable.createdAt)
      })) ||
      (await db.query.postMediaTable.findFirst({
        where: eq(postMediaTable.draftId, draftId),
        orderBy: desc(postMediaTable.createdAt)
      }))

    const previousConcept =
      (existingMedia?.metadata as any)?.mediaBrief?.primaryConcept ||
      existingMedia?.promptOrQuery ||
      undefined
    const previousImagePrompt = existingMedia?.promptOrQuery || undefined
    const previousImageUrl = existingMedia?.imageUrl || undefined
    const currentVersion = existingMedia?.version || 1
    const currentAttempt = existingMedia?.regenerationAttempt || 0

    const fullPostContent = `${draft.hook}\n\n${draft.body}\n\n${draft.cta || ''}`
    const mode = options?.mode || 'ai_generated'
    const customPrompt = options?.customPrompt?.trim() || undefined
    // Only the reviewer's own words go to the model as their reason; the brief
    // already asks for a different concept from the rejected one.
    const reviewerReason = options?.rejectionReason?.trim() || undefined
    // A typed stock query is searched as written, so the image is the reviewer's
    // own pick; it was not scored against the post.
    const mediaSource =
      mode === 'stock' && customPrompt ? REVIEWER_SEARCH_SOURCE : undefined

    // 2. Produce the new visual before touching the current one, so a failed
    //    search or generation leaves the post's image in place.
    const mediaPlan = await regenerateMediaPlan({
      draftId,
      mode,
      // A typed stock query is searched as written; for a generated image the
      // reviewer's words steer the new concept.
      searchQuery: mode === 'stock' ? customPrompt : undefined,
      direction: mode === 'ai_generated' ? customPrompt : undefined,
      postText: fullPostContent,
      thesis: thesis || coreArgument || topic,
      previousMediaId: existingMedia?.id,
      previousConcept,
      previousImagePrompt,
      previousImageUrl,
      rejectionReason: reviewerReason,
      regenerationAttempt: currentAttempt,
      version: currentVersion,
      evidence,
      ...(await loadMediaSettings(draft.accountId))
    })

    // Charged to the post's run whether or not an image came back.
    await recordReviewMediaSpend(draftId, mediaPlan.usage, {
      summary: `New media (${mediaPlan.mode}) (post review)`,
      error: mediaPlan.imageUrl ? null : mediaPlan.error || 'No image produced'
    })

    if (mediaPlan.mode !== 'none' && mediaPlan.imageUrl) {
      // 3. Supersede and insert together: never return or overwrite existing media.
      const newMedia = await db.transaction(async tx => {
        if (existingMedia) {
          await tx
            .update(postMediaTable)
            .set({
              status: 'superseded',
              rejectionReason:
                reviewerReason ||
                'User triggered media regeneration for new concept',
              updatedAt: new Date()
            })
            .where(eq(postMediaTable.id, existingMedia.id))
        }

        const [inserted] = await tx
          .insert(postMediaTable)
          .values({
            draftId,
            version: mediaPlan.version,
            status: 'active',
            previousMediaId: existingMedia?.id || null,
            regenerationAttempt: mediaPlan.regenerationAttempt,
            rejectionReason: reviewerReason || null,
            mode: mediaPlan.mode,
            imageUrl: mediaPlan.imageUrl,
            altText: mediaPlan.altText || null,
            promptOrQuery: mediaPlan.promptOrQuery || null,
            metadata: {
              ...(mediaSource ? { source: mediaSource } : {}),
              sourcePageUrl: mediaPlan.sourcePageUrl,
              fallbackApplied: mediaPlan.fallbackApplied || false,
              visualType: mediaPlan.visualType,
              relevanceScore: mediaPlan.relevanceScore,
              relevanceExplanation: mediaPlan.relevanceExplanation,
              alignedConcepts: mediaPlan.alignedConcepts,
              textOverlay: mediaPlan.textOverlay,
              mediaBrief: mediaPlan.mediaBrief,
              issues: mediaPlan.issues,
              providerRequestId: mediaPlan.providerRequestId,
              seed: mediaPlan.seed,
              usage: mediaPlan.usage
            }
          })
          .returning()

        if (!inserted)
          throw new Error('Failed to insert regenerated media record')
        return inserted
      })

      revalidatePath('/posts')
      revalidatePath(`/posts/${draftId}`)

      return {
        success: true,
        media: {
          id: newMedia.id,
          version: newMedia.version,
          status: newMedia.status,
          mode: mediaPlan.mode,
          imageUrl: mediaPlan.imageUrl,
          altText: mediaPlan.altText,
          promptOrQuery: mediaPlan.promptOrQuery,
          source: mediaSource,
          fallbackApplied: mediaPlan.fallbackApplied,
          visualType: mediaPlan.visualType,
          relevanceScore: mediaPlan.relevanceScore,
          relevanceExplanation: mediaPlan.relevanceExplanation,
          issues: mediaPlan.issues,
          mediaBrief: mediaPlan.mediaBrief,
          providerRequestId: mediaPlan.providerRequestId,
          seed: mediaPlan.seed,
          regenerationAttempt: newMedia.regenerationAttempt
        }
      }
    }

    return {
      success: false,
      error: mediaPlan.error || 'Could not generate visual for this post'
    }
  } catch (err: any) {
    console.error('Error regenerating post media:', err)
    return {
      success: false,
      error: err?.message || 'Failed to regenerate media'
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

    return { success: true as const, imageUrl: media.imageUrl }
  } catch (err: any) {
    console.error('Error loading post media image:', err)
    return {
      success: false as const,
      error: err?.message || 'Failed to load image'
    }
  }
}
