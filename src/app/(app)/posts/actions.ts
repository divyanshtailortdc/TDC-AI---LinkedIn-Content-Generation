'use server'

import { db } from '@/db'
import {
  feedbackTable,
  ideasTable,
  postDraftsTable,
  postMediaTable
} from '@/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { createMediaPlan } from '~/lib/media'

export async function updateDraft(
  draftId: string,
  payload: {
    hook?: string
    body?: string
    firstComment?: string
  }
) {
  try {
    const existing = await db.query.postDraftsTable.findFirst({
      where: eq(postDraftsTable.id, draftId)
    })

    if (!existing) throw new Error('Draft not found')

    const newHook = payload.hook ?? existing.hook
    const newBody = payload.body ?? existing.body
    const fullText = `${newHook}\n\n${newBody}`

    await db
      .update(postDraftsTable)
      .set({
        hook: newHook,
        body: newBody,
        firstComment:
          payload.firstComment !== undefined
            ? payload.firstComment
            : existing.firstComment,
        charCount: fullText.length,
        editedBody: newBody,
        updatedAt: new Date()
      })
      .where(eq(postDraftsTable.id, draftId))

    revalidatePath('/posts')
    revalidatePath(`/posts/${draftId}`)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to update draft' }
  }
}

export async function approveDraft(draftId: string) {
  try {
    await db
      .update(postDraftsTable)
      .set({
        status: 'approved',
        approvedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(postDraftsTable.id, draftId))

    revalidatePath('/posts')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to approve draft' }
  }
}

export async function rejectDraft(draftId: string, reason?: string) {
  try {
    const draft = await db.query.postDraftsTable.findFirst({
      where: eq(postDraftsTable.id, draftId)
    })

    if (!draft) throw new Error('Draft not found')

    await db
      .update(postDraftsTable)
      .set({
        status: 'rejected',
        updatedAt: new Date()
      })
      .where(eq(postDraftsTable.id, draftId))

    if (reason) {
      await db.insert(feedbackTable).values({
        accountId: draft.accountId,
        draftId: draft.id,
        verdict: 'rejected',
        reasonText: reason,
        reasonTags: ['draft_rejected'],
        originalBody: draft.body
      })
    }

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
  try {
    const existingDraft = await db.query.postDraftsTable.findFirst({
      where: eq(postDraftsTable.id, draftId)
    })
    if (!existingDraft) throw new Error('Post draft not found')

    const existingMedia = await db.query.postMediaTable.findFirst({
      where: eq(postMediaTable.draftId, draftId)
    })

    if (payload.mode === 'none' || !payload.imageUrl) {
      if (existingMedia) {
        await db
          .delete(postMediaTable)
          .where(eq(postMediaTable.draftId, draftId))
      }
      revalidatePath('/posts')
      return { success: true, media: null }
    }

    if (existingMedia) {
      await db
        .update(postMediaTable)
        .set({
          mode: payload.mode,
          imageUrl: payload.imageUrl,
          altText: payload.altText || null,
          promptOrQuery: payload.promptOrQuery || null,
          updatedAt: new Date()
        })
        .where(eq(postMediaTable.draftId, draftId))
    } else {
      await db.insert(postMediaTable).values({
        draftId,
        mode: payload.mode,
        imageUrl: payload.imageUrl,
        altText: payload.altText || null,
        promptOrQuery: payload.promptOrQuery || null
      })
    }

    revalidatePath('/posts')
    return {
      success: true,
      media: {
        mode: payload.mode,
        imageUrl: payload.imageUrl,
        altText: payload.altText,
        promptOrQuery: payload.promptOrQuery
      }
    }
  } catch (err: any) {
    console.error('Error updating post media:', err)
    return { success: false, error: err?.message || 'Failed to update media' }
  }
}

export async function removePostMediaAction(draftId: string) {
  try {
    await db.delete(postMediaTable).where(eq(postMediaTable.draftId, draftId))

    revalidatePath('/posts')
    return { success: true }
  } catch (err: any) {
    console.error('Error removing post media:', err)
    return { success: false, error: err?.message || 'Failed to remove media' }
  }
}

export async function regeneratePostMediaAction(
  draftId: string,
  options?: {
    mode?: 'ai_generated' | 'stock'
    customPrompt?: string
  }
) {
  try {
    const draft = await db.query.postDraftsTable.findFirst({
      where: eq(postDraftsTable.id, draftId)
    })
    if (!draft) throw new Error('Post draft not found')

    let topic = 'Business strategy'
    let coreArgument: string | undefined = undefined
    let thesis: string | undefined = undefined
    let evidence: any[] = []

    if (draft.ideaId) {
      const idea = await db.query.ideasTable.findFirst({
        where: eq(ideasTable.id, draft.ideaId)
      })
      if (idea) {
        topic = idea.pillar || idea.title || topic
        coreArgument = idea.coreArgument || undefined
        thesis = idea.thesis || idea.coreArgument || undefined
        evidence = (idea.supportingEvidence as any[]) || []
      }
    }

    const mode = options?.mode || 'ai_generated'
    const brief = options?.customPrompt?.trim() || draft.hook
    const fullPostContent = `${draft.hook}\n\n${draft.body}\n\n${draft.cta || ''}`

    const mediaPlan = await createMediaPlan({
      mode,
      brief,
      topic,
      hook: draft.hook,
      postText: fullPostContent,
      thesis: thesis || coreArgument || topic,
      coreArgument,
      evidence
    })

    if (mediaPlan.mode !== 'none' && mediaPlan.imageUrl) {
      const existingMedia = await db.query.postMediaTable.findFirst({
        where: eq(postMediaTable.draftId, draftId)
      })

      const mediaMetadata = {
        sourcePageUrl: mediaPlan.sourcePageUrl,
        fallbackApplied: mediaPlan.fallbackApplied || false,
        visualType: mediaPlan.visualType,
        relevanceScore: mediaPlan.relevanceScore,
        relevanceExplanation: mediaPlan.relevanceExplanation,
        alignedConcepts: mediaPlan.alignedConcepts,
        textOverlay: mediaPlan.textOverlay,
        mediaBrief: mediaPlan.mediaBrief
      }

      if (existingMedia) {
        await db
          .update(postMediaTable)
          .set({
            mode: mediaPlan.mode,
            imageUrl: mediaPlan.imageUrl,
            altText: mediaPlan.altText || null,
            promptOrQuery: mediaPlan.promptOrQuery || null,
            metadata: mediaMetadata,
            updatedAt: new Date()
          })
          .where(eq(postMediaTable.draftId, draftId))
      } else {
        await db.insert(postMediaTable).values({
          draftId,
          mode: mediaPlan.mode,
          imageUrl: mediaPlan.imageUrl,
          altText: mediaPlan.altText || null,
          promptOrQuery: mediaPlan.promptOrQuery || null,
          metadata: mediaMetadata
        })
      }

      revalidatePath('/posts')
      return {
        success: true,
        media: {
          mode: mediaPlan.mode,
          imageUrl: mediaPlan.imageUrl,
          altText: mediaPlan.altText,
          promptOrQuery: mediaPlan.promptOrQuery,
          fallbackApplied: mediaPlan.fallbackApplied
        }
      }
    }

    return { success: false, error: 'Could not generate visual for this post' }
  } catch (err: any) {
    console.error('Error regenerating post media:', err)
    return {
      success: false,
      error: err?.message || 'Failed to regenerate media'
    }
  }
}
