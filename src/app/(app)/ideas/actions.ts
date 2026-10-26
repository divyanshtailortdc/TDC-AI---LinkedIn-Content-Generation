'use server'

import { db } from '@/db'
import { feedbackTable, ideasTable } from '@/db/schema'
import { requireOwnedIdea, requireOwnedRun } from '@/lib/account-guard'
import { requireIdentityId } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import { requireUser } from '@/lib/session'
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { enqueueDrafting } from '~/jobs/drafting-queue'
import {
  claimDraftSelection,
  describeDraftSelection
} from '~/lib/ai/pipeline/draft-selection'
import {
  settleRunAfterDrafting,
  settleRunAfterIdeaDecision
} from '~/lib/ai/pipeline/drafting-run'

// These actions mutate a specific idea/run identified by its own id. The id
// comes from the client, so it is first looked up under the signed-in user's
// identity (requireOwnedIdea / requireOwnedRun): someone else's idea or run
// is "not found".

/**
 * An idea that is drafted, or being drafted, keeps that status: approving it
 * again would make it draftable a second time, and so a second post.
 */
const NOT_YET_DRAFTED = notInArray(ideasTable.status, ['drafting', 'drafted'])

export async function approveIdea(ideaId: string) {
  const user = await requireUser()
  try {
    const idea = await requireOwnedIdea(user.id, ideaId)

    const approved = await db
      .update(ideasTable)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(and(eq(ideasTable.id, idea.id), NOT_YET_DRAFTED))
      .returning({ id: ideasTable.id })
    if (approved.length === 0)
      throw new Error('This idea is already drafted or being drafted')

    // An approved idea is waiting to be drafted, so a run that read
    // "completed" goes back to awaiting approval and offers "Create posts".
    if (idea.runId) {
      await settleRunAfterIdeaDecision(idea.runId).catch(err =>
        console.error(`Could not settle run ${idea.runId}:`, err)
      )
    }

    // No revalidatePath: it re-rendered the whole page and layout with every
    // click. The pages update the idea and the sidebar badge themselves
    // (~/lib/ideas-badge).
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to approve idea' }
  }
}

export async function rejectIdea(ideaId: string, reason?: string) {
  const user = await requireUser()
  try {
    const idea = await requireOwnedIdea(user.id, ideaId)

    // A stale tab could otherwise reject an idea already drafted (or being
    // drafted), then approve and draft it again: a second post for one idea,
    // and a paid-for draft thrown away.
    const rejected = await db
      .update(ideasTable)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(and(eq(ideasTable.id, idea.id), NOT_YET_DRAFTED))
      .returning({ id: ideasTable.id })
    if (rejected.length === 0)
      throw new Error('This idea is already drafted or being drafted')

    // Rejecting the last idea waiting on a decision finishes the run; left
    // alone it would read "awaiting idea approval" with nothing to approve.
    if (idea.runId) {
      await settleRunAfterIdeaDecision(idea.runId).catch(err =>
        console.error(`Could not settle run ${idea.runId}:`, err)
      )
    }

    if (reason) {
      await db.insert(feedbackTable).values({
        accountId: idea.accountId,
        verdict: 'rejected',
        reasonText: reason,
        reasonTags: ['idea_rejected']
      })
    }

    // No revalidatePath; see approveIdea.
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
  const user = await requireUser()
  try {
    const idea = await requireOwnedIdea(user.id, ideaId)

    const currentMedia = (idea.suggestedMedia as any) || { mode: 'none' }

    // Editing an idea once it is drafted would change it under its post.
    const edited = await db
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
      .where(and(eq(ideasTable.id, idea.id), NOT_YET_DRAFTED))
      .returning({ id: ideasTable.id })
    if (edited.length === 0)
      throw new Error('This idea is already drafted or being drafted')

    revalidatePath('/ideas')
    revalidatePath('/runs')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to edit idea' }
  }
}

/**
 * Starts posts for the selected ideas: only those that are approved, and only
 * the identity's own (a run's own, when `runId` is given). Selected ideas that
 * are not approved are skipped and counted, never drafted.
 *
 * Answers as soon as the ideas are claimed: the drafting queue writes the
 * posts afterwards, and the page follows them with fetchIdeaStatuses.
 */
export async function draftSelectedIdeas(options: {
  ideaIds: string[]
  runId?: string
}) {
  const user = await requireUser()
  try {
    // A server action's arguments come from the browser, whatever the types say.
    const ideaIds = Array.isArray(options?.ideaIds)
      ? options.ideaIds.filter(isUuid)
      : []
    if (ideaIds.length === 0) {
      return {
        success: false,
        error: 'Select the approved ideas to turn into posts.'
      }
    }
    const accountId = await requireIdentityId()
    const runId = options.runId
      ? (await requireOwnedRun(user.id, options.runId)).id
      : null

    const outcome = await claimDraftSelection(
      db,
      { accountId, ideaIds, runId },
      { settleRun: settleRunAfterDrafting }
    )
    enqueueDrafting(outcome.claimed)

    revalidatePath('/ideas')
    revalidatePath('/runs')

    if (outcome.queued === 0) {
      return {
        success: false,
        error:
          describeDraftSelection(outcome) || 'No approved ideas found to draft'
      }
    }
    return {
      success: true,
      queuedIds: outcome.claimed.map(c => c.ideaId),
      // Why some selected ideas will not become posts, if any will not.
      note: describeDraftSelection(outcome) || null
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to draft the selected ideas'
    }
  }
}

/**
 * Where the given ideas stand, for a page following ideas being drafted:
 * "drafting" until each is done, then "drafted", or "approved" again when its
 * draft failed.
 */
export async function fetchIdeaStatuses(ideaIds: string[]) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    // A server action's arguments come from the browser, whatever the types say.
    const ids = Array.isArray(ideaIds)
      ? ideaIds.filter(isUuid).slice(0, 200)
      : []
    const ideas =
      ids.length === 0
        ? []
        : await db
            .select({ id: ideasTable.id, status: ideasTable.status })
            .from(ideasTable)
            .where(
              and(
                eq(ideasTable.accountId, accountId),
                inArray(ideasTable.id, ids)
              )
            )
    return { success: true as const, ideas }
  } catch (err: any) {
    return {
      success: false as const,
      error: err.message || 'Failed to fetch the ideas'
    }
  }
}

export async function approveAllIdeas(ideaIds: string[]) {
  await requireUser()
  try {
    if (ideaIds.length === 0)
      return { success: false, error: 'No ideas to approve' }

    const identityId = await requireIdentityId()

    // The ids come from a list that may be stale: some ideas may have been
    // drafted since. Those rows are left alone, so only the ones actually
    // updated count as approved.
    const approved = await db
      .update(ideasTable)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(
        and(
          inArray(ideasTable.id, ideaIds),
          eq(ideasTable.accountId, identityId),
          NOT_YET_DRAFTED
        )
      )
      .returning({ id: ideasTable.id, runId: ideasTable.runId })

    if (approved.length === 0) {
      return {
        success: false,
        error:
          'None of these ideas could be approved. They may already be drafted. Refresh the page to see their current status.'
      }
    }

    // Same as approveIdea: each affected run is waiting on drafting again.
    const runIds = new Set(
      approved.map(i => i.runId).filter((id): id is string => Boolean(id))
    )
    await Promise.all(
      [...runIds].map(runId =>
        settleRunAfterIdeaDecision(runId).catch(err =>
          console.error(`Could not settle run ${runId}:`, err)
        )
      )
    )

    // The sidebar's Ideas badge counts these.
    revalidatePath('/', 'layout')
    revalidatePath('/ideas')
    revalidatePath('/runs')
    return { success: true, approvedIds: approved.map(i => i.id) }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to approve ideas' }
  }
}

/**
 * Approves several ideas of one run, and settles the run once. Scoped by the
 * run's own id, like approveIdea. Ideas that are drafted or being drafted are
 * left alone, so only the returned ids count.
 */
export async function approveRunIdeas(runId: string, ideaIds: string[]) {
  const user = await requireUser()
  try {
    if (ideaIds.length === 0)
      return { success: false, error: 'No ideas to approve' }
    const run = await requireOwnedRun(user.id, runId)

    const approved = await db
      .update(ideasTable)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(
        and(
          eq(ideasTable.runId, run.id),
          inArray(ideasTable.id, ideaIds),
          NOT_YET_DRAFTED
        )
      )
      .returning({ id: ideasTable.id })

    if (approved.length === 0) {
      return {
        success: false,
        error:
          'None of these ideas could be approved. They may already be drafted. Refresh the page to see their current status.'
      }
    }

    await settleRunAfterIdeaDecision(run.id).catch(err =>
      console.error(`Could not settle run ${run.id}:`, err)
    )

    // The sidebar's Ideas badge counts these.
    revalidatePath('/', 'layout')
    revalidatePath('/ideas')
    revalidatePath('/runs')
    return { success: true, approvedIds: approved.map(i => i.id) }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to approve ideas' }
  }
}
