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
 * The queue lives in the process that claimed the ideas. The claims are what
 * survives that process going away (a restart, or a Vercel function frozen
 * or ended). They are touched while held here, and recoverAbandonedDrafting
 * (the worker's recovery timer, /api/cron/jobs, and pages following ideas
 * being drafted) takes over any left untouched, so those ideas are drafted,
 * not stranded. enqueueDrafting resolves when its ideas are done, so a
 * Vercel function can stay alive until then (`after`).
 */

type QueuedIdea = { ideaId: string; runId: string | null }

type DraftingQueue = {
  waiting: QueuedIdea[]
  active: Map<string, QueuedIdea>
  heartbeat: NodeJS.Timeout | undefined
  /** Callbacks for each idea, called once it has left the queue. */
  waiters: Map<string, Array<() => void>>
}

declare global {
  var __draftingQueue: DraftingQueue | undefined
}

/** Ideas drafted at once: each holds model calls and image rendering on one vCPU. */
const CONCURRENCY = 2

const queue = (): DraftingQueue => {
  const q = (globalThis.__draftingQueue ??= {
    waiting: [],
    active: new Map(),
    heartbeat: undefined,
    waiters: new Map()
  })
  // A queue made by an earlier version of this module (hot reload) has none.
  q.waiters ??= new Map()
  return q
}

/** Every idea this process holds a claim on: waiting or being drafted. */
const heldIds = () => {
  const q = queue()
  return [...q.waiting.map(i => i.ideaId), ...q.active.keys()]
}

/**
 * Queues ideas already claimed by the caller; ones already queued are not
 * queued twice. Resolves once every one of them has been drafted or has
 * failed.
 */
export function enqueueDrafting(ideas: QueuedIdea[]): Promise<void> {
  const q = queue()
  const done = Promise.all(
    ideas.map(
      idea =>
        new Promise<void>(resolve => {
          const list = q.waiters.get(idea.ideaId) ?? []
          list.push(resolve)
          q.waiters.set(idea.ideaId, list)
        })
    )
  ).then(() => undefined)
  const held = new Set(heldIds())
  for (const idea of ideas) {
    if (held.has(idea.ideaId)) continue
    held.add(idea.ideaId)
    q.waiting.push(idea)
  }
  if (q.waiting.length === 0) return done
  q.heartbeat ??= setInterval(() => {
    touchDraftingClaims(db, heldIds()).catch(err =>
      console.error('Could not refresh drafting claims:', err)
    )
  }, DRAFTING_HEARTBEAT_MS).unref()
  pump()
  return done
}

function pump() {
  const q = queue()
  while (q.active.size < CONCURRENCY && q.waiting.length > 0) {
    const idea = q.waiting.shift()!
    q.active.set(idea.ideaId, idea)
    void draft(idea).finally(() => {
      q.active.delete(idea.ideaId)
      for (const resolve of q.waiters.get(idea.ideaId) ?? []) resolve()
      q.waiters.delete(idea.ideaId)
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

/**
 * Drafts ideas whose claims were left by a process that went away. Resolves
 * once they are drafted.
 */
export async function recoverAbandonedDrafting() {
  const taken = await takeOverAbandonedDraftingClaims(db, heldIds())
  if (taken.length === 0) return
  console.warn(
    `Resuming drafting of abandoned ideas: ${taken.map(i => i.id).join(', ')}`
  )
  await enqueueDrafting(taken.map(i => ({ ideaId: i.id, runId: i.runId })))
}

const RESUME_EVERY_MS = 30_000
let lastResume = 0

/**
 * recoverAbandonedDrafting at most every 30 seconds per process, for pages
 * that poll ideas being drafted: where nothing polls for jobs on a timer
 * (Vercel), they are what resumes a batch whose function ended.
 */
export function resumeAbandonedDrafting(): Promise<void> {
  const now = Date.now()
  if (now - lastResume < RESUME_EVERY_MS) return Promise.resolve()
  lastResume = now
  return recoverAbandonedDrafting()
}
