import { ideasTable } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { DraftingDb } from './drafting-claim'

/**
 * Posts are written only from the ideas the reviewer selected, and of those
 * only the approved ones. "Create posts" used to draft every approved idea of
 * the identity (or of a run), so approving an idea to keep it for later also
 * queued it for a post. Now the selection is the request: an idea that was not
 * selected is never drafted, and a selected one that is still to review, or
 * rejected, is skipped and counted so the reviewer is told why.
 *
 * Takes the database and the drafting steps as arguments so the selection
 * rules can be run against any connection without calling a model.
 */

export type DraftSelectionOutcome = {
  drafted: number
  /** Selected but not approved (still to review, or rejected). */
  notApproved: number
  /** Selected but already drafted, or being drafted by another request. */
  alreadyDrafted: number
  /** Selected ids that are not this identity's ideas (or not this run's). */
  notFound: number
}

/**
 * Which selected ideas may be drafted, in the order they were selected. An
 * idea being drafted is included so a claim left by a crashed request can be
 * taken over once stale; the claim decides (see drafting-claim).
 */
export function planDraftSelection(
  selectedIds: string[],
  found: Array<{ id: string; status: string }>
): {
  draftable: string[]
  notApproved: number
  alreadyDrafted: number
  notFound: number
} {
  const ids = Array.from(new Set(selectedIds))
  const byId = new Map(found.map(i => [i.id, i.status]))
  const draftable: string[] = []
  let notApproved = 0
  let alreadyDrafted = 0
  let notFound = 0
  for (const id of ids) {
    const status = byId.get(id)
    if (status === undefined) notFound++
    else if (status === 'approved' || status === 'drafting') draftable.push(id)
    else if (status === 'drafted') alreadyDrafted++
    else notApproved++
  }
  return { draftable, notApproved, alreadyDrafted, notFound }
}

export async function draftSelection(
  database: DraftingDb,
  selection: {
    accountId: string
    ideaIds: string[]
    /** Only this run's ideas, when drafting from a run's page. */
    runId?: string | null
  },
  steps: {
    /** Drafts one idea; null when its claim was lost (drafted elsewhere). */
    draft: (ideaId: string) => Promise<unknown | null>
    /** Puts a run's status back in line with its ideas. */
    settleRun: (runId: string) => Promise<void>
  }
): Promise<DraftSelectionOutcome> {
  const found =
    selection.ideaIds.length === 0
      ? []
      : await database
          .select({
            id: ideasTable.id,
            status: ideasTable.status,
            runId: ideasTable.runId
          })
          .from(ideasTable)
          .where(
            and(
              inArray(ideasTable.id, selection.ideaIds),
              eq(ideasTable.accountId, selection.accountId),
              selection.runId
                ? eq(ideasTable.runId, selection.runId)
                : undefined
            )
          )

  const plan = planDraftSelection(selection.ideaIds, found)
  let drafted = 0
  let alreadyDrafted = plan.alreadyDrafted
  try {
    // Each idea is claimed before it is drafted, so one already drafted or
    // being drafted by another request (a retry, a double click) is skipped
    // rather than drafted again.
    for (const id of plan.draftable) {
      if (await steps.draft(id)) drafted++
      else alreadyDrafted++
    }
  } finally {
    // Whether it finished or failed part-way, each run it touched is put
    // back to a status that matches its ideas.
    const runIds = new Set(
      found
        .filter(i => plan.draftable.includes(i.id))
        .map(i => i.runId)
        .filter((r): r is string => Boolean(r))
    )
    await Promise.all(
      [...runIds].map(runId =>
        steps
          .settleRun(runId)
          .catch(err => console.error(`Could not settle run ${runId}:`, err))
      )
    )
  }

  return {
    drafted,
    notApproved: plan.notApproved,
    alreadyDrafted,
    notFound: plan.notFound
  }
}

/** Why nothing (or not everything) selected became a post, in plain words. */
export function describeDraftSelection(outcome: DraftSelectionOutcome): string {
  const parts: string[] = []
  const ideas = (n: number) => `${n} selected idea${n === 1 ? '' : 's'}`
  if (outcome.notApproved > 0) {
    parts.push(
      `${ideas(outcome.notApproved)} ${outcome.notApproved === 1 ? 'is' : 'are'} not approved, so no post was made from ${outcome.notApproved === 1 ? 'it' : 'them'}. Approve ${outcome.notApproved === 1 ? 'it' : 'them'} first.`
    )
  }
  if (outcome.alreadyDrafted > 0) {
    parts.push(
      `${ideas(outcome.alreadyDrafted)} ${outcome.alreadyDrafted === 1 ? 'was' : 'were'} already drafted.`
    )
  }
  if (outcome.notFound > 0) {
    parts.push(
      `${ideas(outcome.notFound)} could not be found. Refresh the page to see their current status.`
    )
  }
  return parts.join(' ')
}
