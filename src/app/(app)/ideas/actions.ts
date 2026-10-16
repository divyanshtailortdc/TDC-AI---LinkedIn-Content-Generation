'use server'

import { db } from '@/db'
import { ideasTable, feedbackTable } from '@/db/schema'
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { executeDraftingForIdea } from '~/lib/ai/pipeline/drafting-run'
import { revalidatePath } from 'next/cache'
import { requireActiveAccountId } from '@/lib/active-account'

// These actions mutate a specific idea/run identified by its own id, which is
// already scoped server-side wherever it's read (the /ideas list is fetched
// for the active account only, and /runs/[id] loads a specific run's own
// account). So the idea's real accountId — looked up here, never trusted
// from the client — is the authoritative scope, not whichever account
// happens to be "active" in the cookie right now. Requiring a cookie match
// would break legitimate actions taken from a run's detail page when that
// run belongs to an account other than the currently active one.

/**
 * An idea that is drafted, or being drafted, keeps that status: approving it
 * again would make it draftable a second time, and so a second post.
 */
const NOT_YET_DRAFTED = notInArray(ideasTable.status, ['drafting', 'drafted'])

export async function approveIdea(ideaId: string) {
  try {
    const idea = await db.query.ideasTable.findFirst({
      where: eq(ideasTable.id, ideaId)
    })
    if (!idea) throw new Error('Idea not found')

    await db
      .update(ideasTable)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(and(eq(ideasTable.id, ideaId), NOT_YET_DRAFTED))

    // The sidebar's Ideas badge counts these.
    revalidatePath('/', 'layout')
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

    // The sidebar's Ideas badge counts these.
    revalidatePath('/', 'layout')
    revalidatePath('/ideas')
    revalidatePath('/runs')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to reject idea' }
  }
}

export async function editIdea(
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
        updatedAt: new Date()
      })
      .where(eq(ideasTable.id, ideaId))

    revalidatePath('/ideas')
    revalidatePath('/runs')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to edit idea' }
  }
}

export async function draftApprovedIdeas(options: { runId?: string; ideaIds?: string[] }) {
  try {
    let targetIdeaIds: string[] = []

    if (options.ideaIds && options.ideaIds.length > 0) {
      // The ideaIds path is only ever called from the /ideas list (already
      // scoped to the active account), so re-scope to it defensively against
      // stale ids from a previous session.
      const activeAccountId = await requireActiveAccountId()
      const owned = await db.query.ideasTable.findMany({
        where: and(
          inArray(ideasTable.id, options.ideaIds),
          eq(ideasTable.accountId, activeAccountId)
        )
      })
      targetIdeaIds = owned.map((i) => i.id)
    } else if (options.runId) {
      // The runId path is called from a specific run's own detail page,
      // which may not belong to the currently active account — the run's
      // own account is the correct scope here, not the active-account cookie.
      // Ideas being drafted are included so a claim left by a crashed request
      // can be taken over once stale; executeDraftingForIdea decides.
      const approvedIdeas = await db.query.ideasTable.findMany({
        where: and(
          eq(ideasTable.runId, options.runId),
          inArray(ideasTable.status, ['approved', 'drafting'])
        )
      })
      targetIdeaIds = approvedIdeas.map((i) => i.id)
    }

    if (targetIdeaIds.length === 0) {
      return { success: false, error: 'No approved ideas found to draft' }
    }

    // Each idea is claimed before it is drafted, so one already drafted or
    // being drafted by another request (a retry, a double click) is skipped
    // rather than drafted again.
    const results = []
    for (const id of targetIdeaIds) {
      const res = await executeDraftingForIdea(id)
      if (res) results.push(res)
    }

    revalidatePath('/ideas')
    revalidatePath('/posts')
    revalidatePath('/runs')

    return { success: true, draftedCount: results.length }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to draft approved ideas' }
  }
}

export async function approveAllIdeas(ideaIds: string[]) {
  try {
    if (ideaIds.length === 0) return { success: true }

    const activeAccountId = await requireActiveAccountId()

    await db
      .update(ideasTable)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(
        and(
          inArray(ideasTable.id, ideaIds),
          eq(ideasTable.accountId, activeAccountId),
          NOT_YET_DRAFTED
        )
      )

    // The sidebar's Ideas badge counts these.
    revalidatePath('/', 'layout')
    revalidatePath('/ideas')
    revalidatePath('/runs')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to approve ideas' }
  }
}
