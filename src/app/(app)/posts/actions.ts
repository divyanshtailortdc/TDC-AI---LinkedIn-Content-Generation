'use server'

import { db } from '@/db'
import { postDraftsTable, feedbackTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

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
        firstComment: payload.firstComment !== undefined ? payload.firstComment : existing.firstComment,
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
