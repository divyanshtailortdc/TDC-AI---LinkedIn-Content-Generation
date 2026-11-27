'use server'

import { db } from '@/db'
import { feedbackTable, ideasTable, postDraftsTable } from '@/db/schema'
import {
  canHaveImage,
  cleanFormats,
  FORMATS,
  isCreatableFormat,
  supportsMediaFormat,
  type FormatId
} from '@/lib/formats'
import { formatsStillToDraft } from '@/lib/formats/drafted'
import { isVideoFormat, VIDEO_GENERATION_ENABLED } from '@/lib/video/formats'
import { requireOwnedIdea, requireOwnedRun } from '@/lib/account-guard'
import { loadChannels } from '@/lib/channels'
import { requireIdentityId } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import { requireUser } from '@/lib/session'
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import {
  draftingErrorOf,
  enqueueDrafting,
  resumeAbandonedDrafting
} from '~/jobs/drafting-queue'
import {
  claimDraftSelection,
  describeDraftSelection
} from '~/lib/ai/pipeline/draft-selection'
import {
  settleRunAfterDrafting,
  settleRunAfterIdeaDecision
} from '~/lib/ai/pipeline/drafting-run'
import { existingPostFormats } from '~/lib/ai/pipeline/idea-posts'

/**
 * The formats picked in "Create posts": ones that can be created and that the
 * identity turned on in its preferences. Refused when none are picked, or
 * when one is turned off (a page opened before Preferences changed).
 */
function chosenFormats(raw: unknown, enabled: readonly FormatId[]): FormatId[] {
  // Videos (Short video in "Create posts") are asked for each time and are
  // never turned on in Preferences, so only the other formats must be on.
  const formats = cleanFormats(raw).filter(
    f => isCreatableFormat(f) || (VIDEO_GENERATION_ENABLED && isVideoFormat(f))
  )
  if (formats.length === 0) {
    throw new Error('Choose at least one platform to write these posts for.')
  }
  const off = formats.find(f => !isVideoFormat(f) && !enabled.includes(f))
  if (off) {
    throw new Error(
      `Turn on ${FORMATS[off].label}s under Identity → Preferences first.`
    )
  }
  return formats
}

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
 * Starts posts for the selected ideas: only those that are approved, or
 * drafted already (for the platforms they have no post on yet), and only
 * the identity's own (a run's own, when `runId` is given). Selected ideas
 * that are not approved are skipped and counted, never drafted; so is a
 * drafted one that already has a post on every platform asked for.
 *
 * Answers as soon as the ideas are claimed: the drafting queue writes the
 * posts afterwards, and the page follows them with fetchIdeaStatuses.
 */
export async function draftSelectedIdeas(options: {
  ideaIds: string[]
  runId?: string
  /**
   * The formats to write each idea in. Absent: each idea's own (what its run
   * chose, or LinkedIn).
   */
  formats?: string[]
  /**
   * Of those, the ones whose posts get an image ("Add an image"). Absent:
   * each format's default (imageChosenFor).
   */
  imageFormats?: string[]
  /**
   * Of those, the ones set to "Carousel"; the rest get a single image. Sent
   * with imageFormats. Absent: drafting plans each (mediaChosenFor).
   */
  carouselFormats?: string[]
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
    // From a run's page, the run's identity (the user may have switched to
    // another since); otherwise the active one.
    const run = options.runId
      ? await requireOwnedRun(user.id, options.runId)
      : null
    const accountId = run?.accountId ?? (await requireIdentityId())
    const runId = run?.id ?? null

    // Selected ideas that already have a post on every platform asked for.
    const nothingNew: string[] = []
    if (options.formats !== undefined) {
      const formats = chosenFormats(
        options.formats,
        (await loadChannels(accountId)).enabledFormats
      )
      // Only chosen formats that can carry an image (not a video script).
      const imageFormats =
        options.imageFormats === undefined
          ? undefined
          : cleanFormats(options.imageFormats).filter(
              f => formats.includes(f) && canHaveImage(f)
            )
      // Only image formats that take slides; an empty list is a choice too
      // (every post a single image), so it is written.
      const carouselFormats =
        imageFormats && options.carouselFormats !== undefined
          ? cleanFormats(options.carouselFormats).filter(
              f => imageFormats.includes(f) && supportsMediaFormat(f, 'carousel')
            )
          : undefined
      // The videos asked for, always written (an empty list too), so a later
      // request without them does not draft an earlier one's video.
      const videoFormats = formats.filter(isVideoFormat)
      const mediaChoice = {
        ...(imageFormats && { imageFormats }),
        ...(carouselFormats && { carouselFormats }),
        videoFormats
      }
      // Set before the claim, so the drafting queue reads them. Ideas not yet
      // approved keep theirs: they are skipped below and not drafted. The
      // image and video choices go into the idea's media plan, merged with
      // what is there, so a drafting resumed after a restart has them too.
      // ::text first: cast straight to jsonb, the driver encodes the
      // parameter again, and || would make the plan an array.
      const mergeMedia = (choice: object) =>
        sql`coalesce(${ideasTable.suggestedMedia}, '{"mode":"none"}'::jsonb) || ${JSON.stringify(choice)}::text::jsonb`
      const writable = and(
        eq(ideasTable.accountId, accountId),
        inArray(ideasTable.status, ['approved', 'drafted'])
      )
      const selected = await db
        .select({
          id: ideasTable.id,
          suggestedMedia: ideasTable.suggestedMedia
        })
        .from(ideasTable)
        .where(and(inArray(ideasTable.id, ideaIds), writable))
      const existing = await existingPostFormats(
        db,
        selected.map(i => i.id)
      )
      // An idea with no post yet is written as asked, all at once.
      const firstTime = selected.filter(i => !existing.has(i.id))
      if (firstTime.length > 0) {
        await db
          .update(ideasTable)
          .set({
            targetFormats: formats,
            suggestedMedia: mergeMedia(mediaChoice),
            updatedAt: new Date()
          })
          .where(
            and(
              inArray(
                ideasTable.id,
                firstTime.map(i => i.id)
              ),
              writable
            )
          )
      }
      // An idea with posts already: only the platforms it has no post on,
      // added to the ones it has; its earlier image and video choices stay
      // for the posts they made.
      for (const idea of selected.filter(i => existing.has(i.id))) {
        const has = existing.get(idea.id) ?? []
        const missing = formatsStillToDraft(formats, has)
        if (missing.length === 0) {
          nothingNew.push(idea.id)
          continue
        }
        const before = idea.suggestedMedia
        const keep = (old: string[] | undefined, now: FormatId[]) => [
          ...cleanFormats(old ?? []).filter(f => !missing.includes(f)),
          ...now.filter(f => missing.includes(f))
        ]
        const choice = {
          ...(imageFormats && {
            imageFormats: keep(before?.imageFormats, imageFormats)
          }),
          ...(carouselFormats && {
            carouselFormats: keep(before?.carouselFormats, carouselFormats)
          }),
          videoFormats: keep(before?.videoFormats, videoFormats)
        }
        await db
          .update(ideasTable)
          .set({
            targetFormats: cleanFormats([...has, ...missing]),
            suggestedMedia: mergeMedia(choice),
            updatedAt: new Date()
          })
          .where(and(eq(ideasTable.id, idea.id), writable))
      }
    }

    const outcome = await claimDraftSelection(
      db,
      {
        accountId,
        ideaIds: ideaIds.filter(id => !nothingNew.includes(id)),
        runId
      },
      { settleRun: settleRunAfterDrafting }
    )
    // Why some selected ideas will not become posts, if any will not.
    const why = [
      describeDraftSelection(outcome),
      nothingNew.length > 0
        ? `${nothingNew.length} selected idea${nothingNew.length === 1 ? ' already has a post' : 's already have posts'} on every platform you picked.`
        : ''
    ]
      .filter(Boolean)
      .join(' ')
    // How many posts each queued idea has now, before drafting starts (it
    // runs after the response), so the page can tell the new ones apart.
    const queuedIds = outcome.claimed.map(c => c.ideaId)
    const postsBefore =
      queuedIds.length === 0
        ? {}
        : Object.fromEntries(
            (
              await db
                .select({
                  ideaId: postDraftsTable.ideaId,
                  n: sql<number>`count(*)::int`
                })
                .from(postDraftsTable)
                .where(inArray(postDraftsTable.ideaId, queuedIds))
                .groupBy(postDraftsTable.ideaId)
            ).map(row => [row.ideaId, row.n])
          )
    // After the response, and kept alive until drafted: on Vercel a function
    // is frozen once it has answered unless `after` holds it open.
    after(() =>
      enqueueDrafting(outcome.claimed).catch(err =>
        console.error('Drafting failed:', err)
      )
    )

    revalidatePath('/ideas')
    revalidatePath('/runs')

    if (outcome.queued === 0) {
      return {
        success: false,
        error: why || 'No approved ideas found to draft'
      }
    }
    return {
      success: true,
      queuedIds,
      postsBefore: postsBefore as Record<string, number>,
      note: why || null
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
 * draft failed. An idea drafted again for more platforms ends "drafted"
 * either way: its number of posts says whether any new one was written.
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
            .select({
              id: ideasTable.id,
              status: ideasTable.status,
              // Spelled "table"."column": in a selected field drizzle leaves
              // the table out, and a bare "id" in here is the post's own id,
              // so every idea counted 0 posts and the page said drafting
              // failed although the posts were saved.
              posts: sql<number>`(select count(*)::int from ${postDraftsTable} where ${sql.identifier('post_drafts')}.${sql.identifier('idea_id')} = ${sql.identifier('ideas')}.${sql.identifier('id')})`
            })
            .from(ideasTable)
            .where(
              and(
                eq(ideasTable.accountId, accountId),
                inArray(ideasTable.id, ids)
              )
            )
    // A batch whose function ended (Vercel's time limit) leaves its claims
    // untouched; the page following it resumes them.
    if (ideas.some(idea => idea.status === 'drafting')) {
      after(() =>
        resumeAbandonedDrafting().catch(err =>
          console.error('Drafting recovery error:', err)
        )
      )
    }
    return {
      success: true as const,
      // Why an idea back to approved was not drafted, when this process knows.
      ideas: ideas.map(idea => {
        const error = idea.status === 'approved' ? draftingErrorOf(idea.id) : null
        return error ? { ...idea, error } : idea
      })
    }
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
 * Deletes ideas of the active identity, one or many. Posts already made from
 * an idea are kept (post_drafts.idea_id is set null), and so are blogs.
 * Ideas being drafted are left alone: their posts are being written and
 * would be saved against an idea that no longer exists. Only the returned
 * ids were deleted.
 */
export async function deleteIdeas(ideaIds: string[]) {
  await requireUser()
  try {
    // A server action's arguments come from the browser, whatever the types say.
    const ids = Array.isArray(ideaIds)
      ? ideaIds.filter(isUuid).slice(0, 500)
      : []
    if (ids.length === 0) {
      return { success: false as const, error: 'Select the ideas to delete.' }
    }
    const identityId = await requireIdentityId()

    const deleted = await db
      .delete(ideasTable)
      .where(
        and(
          inArray(ideasTable.id, ids),
          eq(ideasTable.accountId, identityId),
          notInArray(ideasTable.status, ['drafting'])
        )
      )
      .returning({ id: ideasTable.id, runId: ideasTable.runId })

    if (deleted.length === 0) {
      return {
        success: false as const,
        error:
          'None of these ideas could be deleted. They may be being drafted right now, or already deleted. Refresh the page to see where they stand.'
      }
    }

    // A run waiting on ideas that are now gone reads "completed" instead.
    const runIds = new Set(
      deleted.map(i => i.runId).filter((id): id is string => Boolean(id))
    )
    await Promise.all(
      [...runIds].map(runId =>
        settleRunAfterIdeaDecision(runId).catch(err =>
          console.error(`Could not settle run ${runId}:`, err)
        )
      )
    )

    // The sidebar's Ideas badge counts ideas still to review.
    revalidatePath('/', 'layout')
    revalidatePath('/ideas')
    revalidatePath('/runs')
    return { success: true as const, deletedIds: deleted.map(i => i.id) }
  } catch (err: any) {
    return {
      success: false as const,
      error: err.message || 'Failed to delete the ideas'
    }
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
