/** Run statuses where the pipeline is still working and the row will change on its own. */
export const ACTIVE_RUN_STATUSES = ['queued', 'running', 'researching', 'ideating']

/** What a run is once some of its ideas have been drafted. */
export type DraftingRunStatus =
  | 'drafting'
  | 'awaiting_idea_approval'
  | 'completed'

/**
 * Where a run stands, from the status of its ideas.
 *
 * Ideas still waiting for a decision (proposed) or for drafting (approved)
 * mean the run is not finished: it goes back to awaiting approval, so the page
 * keeps offering "Approve all" and "Create posts". Marking it completed after
 * the first batch, or leaving it on "drafting" after a failure, hid both
 * buttons while ideas were still waiting.
 *
 * `batchRunning`: a request is part-way through drafting its ideas, so ideas
 * not yet reached are expected to be approved and the run stays "drafting".
 */
export function runStatusAfterDrafting(
  ideaStatuses: string[],
  { batchRunning }: { batchRunning: boolean }
): DraftingRunStatus {
  const has = (status: string) => ideaStatuses.includes(status)
  if (has('drafting') || (batchRunning && has('approved'))) return 'drafting'
  if (has('approved') || has('proposed')) return 'awaiting_idea_approval'
  return 'completed'
}
