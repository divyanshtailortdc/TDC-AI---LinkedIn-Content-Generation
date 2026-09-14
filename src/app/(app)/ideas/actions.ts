'use server'

import { db } from '@/db'
import { ideasTable, feedbackTable } from '@/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { executeDraftingForIdea } from '~/lib/ai/draft'
import { revalidatePath } from 'next/cache'

export async function approveIdea(ideaId: string) {
  try {
    await db
      .update(ideasTable)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(ideasTable.id, ideaId))

    revalidatePath('/ideas')
    revalidatePath('/runs')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to approve idea' }
  }
}

export async function rejectIdea(ideaId: string, reason?: string) {
  try {
    const idea = await db.query.ideasTable.findFirst({
      where: eq(ideasTable.id, ideaId)
    })

    if (idea) {
      await db
        .update(ideasTable)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(ideasTable.id, ideaId))

      if (reason) {
        await db.insert(feedbackTable).values({
          accountId: idea.accountId,
          verdict: 'rejected',
          reasonText: reason,
          reasonTags: ['idea_rejected']
        })
      }
    }

    revalidatePath('/ideas')
    revalidatePath('/runs')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to reject idea' }
  }
}

export async function editAndApproveIdea(
  ideaId: string,
  payload: {
    angle?: string
    hookConcept?: string
    mediaMode?: 'ai_generated' | 'stock' | 'none'
  }
) {
  try {
    const idea = await db.query.ideasTable.findFirst({
      where: eq(ideasTable.id, ideaId)
    })

    if (!idea) throw new Error('Idea not found')

    const currentMedia = (idea.suggestedMedia as any) || { mode: 'none' }

    await db
      .update(ideasTable)
      .set({
        angle: payload.angle ?? idea.angle,
        hookConcept: payload.hookConcept ?? idea.hookConcept,
        hook: payload.hookConcept ?? idea.hook,
        suggestedMedia: {
          ...currentMedia,
          mode: payload.mediaMode ?? currentMedia.mode
        },
        status: 'approved',
        updatedAt: new Date()
      })
      .where(eq(ideasTable.id, ideaId))

    revalidatePath('/ideas')
    revalidatePath('/runs')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to edit & approve idea' }
  }
}

export async function draftApprovedIdeas(options: { runId?: string; ideaIds?: string[] }) {
  try {
    let targetIdeaIds: string[] = []

    if (options.ideaIds && options.ideaIds.length > 0) {
      targetIdeaIds = options.ideaIds
    } else if (options.runId) {
      const approvedIdeas = await db.query.ideasTable.findMany({
        where: eq(ideasTable.runId, options.runId)
      })
      targetIdeaIds = approvedIdeas.filter((i) => i.status === 'approved').map((i) => i.id)
    }

    if (targetIdeaIds.length === 0) {
      return { success: false, error: 'No approved ideas found to draft' }
    }

    const results = []
    for (const id of targetIdeaIds) {
      const res = await executeDraftingForIdea(id)
      results.push(res)
    }

    revalidatePath('/ideas')
    revalidatePath('/posts')
    revalidatePath('/runs')

    return { success: true, draftedCount: results.length }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to draft approved ideas' }
  }
}
