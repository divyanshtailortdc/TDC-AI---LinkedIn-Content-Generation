import { db } from '@/db'
import {
  DRAFTING_HEARTBEAT_MS,
  takeOverAbandonedDraftingClaims,
  touchDraftingClaims
} from '~/lib/ai/pipeline/drafting-claim'
import {
  draftClaimedIdeaOrRelease,
  settleRunAfterDrafting
} from '~/lib/ai/pipeline/drafting-run'

/**
 * Drafts claimed ideas in the background, a few at a time. "Create posts"
 * used to draft its whole selection inside the request, one idea after
 * another: minutes per idea, so a batch ran past the request limit and the
 * reviewer saw an error while drafting carried on unseen. The request now only
 * claims the ideas (see claimDraftSelection) and hands them here; the pages
 * poll the ideas' statuses.
 *
 * The queue lives in this process, like the run worker: the app runs as one
 * instance (terraform/main.tf). The claims are what survives a restart. They
 * are touched while held here, and recoverAbandonedDrafting (run by the
 * worker's recovery timer) takes over any left untouched, so ideas whose
 * process went away are drafted, not stranded.
 */

type QueuedIdea = { ideaId: string; runId: string | null }

type DraftingQueue = {
  waiting: QueuedIdea[]
  active: Map<string, QueuedIdea>
  heartbeat: NodeJS.Timeout | undefined
}

declare global {
  var __draftingQueue: DraftingQueue | undefined
}

/** Ideas drafted at once: each holds model calls and image rendering on one vCPU. */
const CONCURRENCY = 2

const queue = (): DraftingQueue =>
  (globalThis.__draftingQueue ??= {
    waiting: [],
    active: new Map(),
    heartbeat: undefined
  })

/** Every idea this process holds a claim on: waiting or being drafted. */
const heldIds = () => {
  const q = queue()
  return [...q.waiting.map(i => i.ideaId), ...q.active.keys()]
}

/** Queues ideas already claimed by the caller; ones already queued are ignored. */
export function enqueueDrafting(ideas: QueuedIdea[]) {
  const q = queue()
  const held = new Set(heldIds())
  for (const idea of ideas) {
    if (held.has(idea.ideaId)) continue
    held.add(idea.ideaId)
    q.waiting.push(idea)
  }
  if (q.waiting.length === 0) return
  q.heartbeat ??= setInterval(() => {
    touchDraftingClaims(db, heldIds()).catch(err =>
      console.error('Could not refresh drafting claims:', err)
    )
  }, DRAFTING_HEARTBEAT_MS).unref()
  pump()
}

function pump() {
  const q = queue()
  while (q.active.size < CONCURRENCY && q.waiting.length > 0) {
    const idea = q.waiting.shift()!
    q.active.set(idea.ideaId, idea)
    void draft(idea).finally(() => {
      q.active.delete(idea.ideaId)
      if (q.active.size === 0 && q.waiting.length === 0) {
        clearInterval(q.heartbeat)
        q.heartbeat = undefined
      }
      pump()
    })
  }
}

async function draft({ ideaId, runId }: QueuedIdea) {
  try {
    await draftClaimedIdeaOrRelease(ideaId)
  } catch (err) {
    // The idea is back to approved, which is what the pages report.
    console.error(`Drafting idea ${ideaId} failed:`, err)
  }
  // The run reads "drafting" while any of its ideas is still claimed.
  if (runId) {
    await settleRunAfterDrafting(runId).catch(err =>
      console.error(`Could not settle run ${runId}:`, err)
    )
  }
}

/** Drafts ideas whose claims were left by a process that went away. */
export async function recoverAbandonedDrafting() {
  const taken = await takeOverAbandonedDraftingClaims(db, heldIds())
  if (taken.length === 0) return
  console.warn(
    `Resuming drafting of abandoned ideas: ${taken.map(i => i.id).join(', ')}`
  )
  enqueueDrafting(taken.map(i => ({ ideaId: i.id, runId: i.runId })))
}
