'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { CreatePostsDialog } from '@/components/create-posts-dialog'
import { Pagination } from '@/components/pagination'
import { PAGE_SIZE, paginate } from '@/lib/pagination'
import type { FormatId } from '@/lib/formats'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  CircleSlash,
  Clock,
  FileText,
  Filter,
  Hourglass,
  Lightbulb,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  SquareCheck,
  Workflow,
  X
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button, buttonClassName } from '@/components/button'
import { RunCostPanel } from '@/components/run-cost-panel'
import { ConfirmPopover } from '@/components/confirm-popover'
import { showToast } from '@/components/toast-notification'
import { markDataChanged } from '@/components/refresh-on-back'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterChips } from '@/components/ui/filter-chips'
import { SectionCard } from '@/components/ui/section-card'
import { StatusChip } from '@/components/ui/status-chip'
import { TimeAgo } from '@/components/ui/time-ago'
import { FOCUS_RING, TONES, type Tone } from '@/components/ui/tone'
import { adjustIdeasToReview } from '@/lib/ideas-badge'
import { cn } from '@/lib/cn'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { isPlatformId, PLATFORMS, type PlatformId } from '@/lib/platforms'
import { fetchRunStatus, pollRunProgress, reanalyzeRun, stopRun } from '../actions'
import { ACTIVE_RUN_STATUSES } from '@/lib/run-status'
import { formatDuration, plural, runStatusDisplay, triggerLabel } from '../run-display'
import {
  approveIdea,
  approveRunIdeas,
  rejectIdea,
  editIdea,
  draftSelectedIdeas
} from '../../ideas/actions'
import { AiDraftingStatus, DraftingStatus } from '~/components/ai-drafting-status'
import { useDraftingPoll } from '../../ideas/use-drafting-poll'
import { isSelectableIdea, RunIdeaCard } from '~/components/run-idea-card'
import {
  EvidenceSection,
  IdeaQualitySection,
  list,
  ProblemsBanner,
  stageFigure
} from './run-insights'

interface RunDetailProps {
  initialRun: any
  initialSteps: any[]
  initialFindings: any[]
  initialIdeas: any[]
  account: any
  /** The formats the run's identity writes: all Create posts offers. */
  enabledFormats: FormatId[]
}

const ACTIVE_STATUSES = ACTIVE_RUN_STATUSES

const POLL_INTERVAL_MS = 5000

/**
 * A backstop: a run interrupted by a restart is failed server-side once its
 * heartbeat goes stale, which ends polling well before this.
 */
const MAX_POLL_MS = 30 * 60_000

const STAGES: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'gathering_context', label: 'Gathering context', icon: BookOpen },
  { key: 'researching', label: 'Researching', icon: Search },
  { key: 'generating_ideas', label: 'Generating ideas', icon: Sparkles },
  { key: 'drafting', label: 'Drafting posts', icon: FileText }
]

type StageState =
  | 'completed'
  | 'partial'
  | 'running'
  | 'failed'
  | 'stopped'
  | 'incomplete'
  | 'waiting'
  | 'pending'

/** How each stage state looks on the stepper: its tone and marker. */
const STAGE_LOOK: Record<StageState, { tone: Tone; icon: LucideIcon }> = {
  completed: { tone: 'success', icon: Check },
  partial: { tone: 'warning', icon: AlertTriangle },
  running: { tone: 'brand', icon: Loader2 },
  failed: { tone: 'danger', icon: X },
  stopped: { tone: 'neutral', icon: Square },
  incomplete: { tone: 'neutral', icon: CircleSlash },
  waiting: { tone: 'warning', icon: Hourglass },
  pending: { tone: 'neutral', icon: Clock }
}

/** The idea filter over the run's ideas, in the Ideas page's order. */
const IDEA_FILTERS = ['proposed', 'approved', 'drafted', 'rejected', 'all'] as const
type IdeaFilter = (typeof IDEA_FILTERS)[number]
const IDEA_FILTER_LABELS: Record<IdeaFilter, string> = {
  proposed: 'To review',
  approved: 'Approved',
  drafted: 'Drafted',
  rejected: 'Rejected',
  all: 'All'
}
const IDEA_FILTER_TONES: Partial<Record<IdeaFilter, Tone>> = {
  proposed: 'warning',
  approved: 'info',
  drafted: 'success',
  rejected: 'danger'
}

/** A text link that sits beside a heading. */
const QUIET_LINK = cn(
  'text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium transition-colors',
  FOCUS_RING
)

/**
 * What a stage saved: the newest of its steps with figures. Steps come newest
 * first. A step still running holds only its usage so far, if anything.
 */
function stageData(steps: any[], stage: string): Record<string, any> | null {
  const step = steps.find(
    s => s.stage === stage && s.responseJson && typeof s.responseJson === 'object'
  )
  return step?.responseJson ?? null
}

/**
 * A stage can hold several steps (drafting records one per post), so its
 * state is summarised over all of them rather than read from the latest.
 */
function summarizeStage(
  key: string,
  steps: any[],
  options: { isRunning: boolean; isNextStage: boolean; awaitingApproval: boolean }
) {
  const stageSteps = steps.filter(s => s.stage === key)
  const done = stageSteps.filter(s => s.status === 'completed').length
  const failed = stageSteps.filter(s => s.status === 'failed').length
  const running = stageSteps.filter(s => s.status === 'running').length
  const stopped = stageSteps.filter(s => s.status === 'stopped').length
  const durationMs = stageSteps.reduce((sum, s) => sum + (s.durationMs || 0), 0)

  let state: StageState
  if (running > 0 && options.isRunning) state = 'running'
  else if (done > 0 && failed > 0) state = 'partial'
  else if (done > 0) state = 'completed'
  else if (failed > 0) state = 'failed'
  else if (stopped > 0) state = 'stopped'
  else if (running > 0) state = 'incomplete'
  else if (options.isRunning && options.isNextStage) state = 'running'
  else if (key === 'drafting' && options.awaitingApproval) state = 'waiting'
  else state = 'pending'

  const duration = durationMs > 0 ? formatDuration(durationMs) : null
  const detail: Record<StageState, string> = {
    completed:
      key === 'drafting'
        ? `${done} post${done === 1 ? '' : 's'}${duration ? ` · ${duration}` : ''}`
        : duration
          ? `Done · ${duration}`
          : 'Done',
    partial: `${done} done · ${failed} failed`,
    running: 'In progress…',
    failed: 'Failed',
    stopped: 'Stopped',
    incomplete: 'Did not finish',
    waiting: 'Awaiting approval',
    pending: 'Not started'
  }

  // While a step runs, what it is doing ("Searching the web…"), for hover text.
  const runningSummary: string | null =
    state === 'running'
      ? (stageSteps.find(s => s.status === 'running')?.requestSummary ?? null)
      : null

  return {
    state,
    detail: detail[state],
    hasSteps: stageSteps.length > 0,
    durationMs,
    runningSummary
  }
}

export function RunDetailClient({
  initialRun,
  initialSteps,
  initialFindings,
  initialIdeas,
  account,
  enabledFormats
}: RunDetailProps) {
  const router = useRouter()
  const hasMounted = useHasMounted()
  // Creating posts asks first which platforms and types of post to write
  // (CreatePostsDialog); the last answer is kept for Try again.
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [lastFormats, setLastFormats] = useState<FormatId[] | undefined>()
  // The formats ticked "Add an image", sent with the formats and kept for
  // Try again, as lastFormats is.
  const imageFormatsRef = useRef<FormatId[] | undefined>(undefined)
  // Of those, the ones set to "Carousel"; the rest get a single image.
  const carouselFormatsRef = useRef<FormatId[] | undefined>(undefined)
  const [run, setRun] = useState(initialRun)
  const [steps, setSteps] = useState(initialSteps)
  const [findings, setFindings] = useState(initialFindings)
  const [ideas, setIdeas] = useState(initialIdeas)
  // Ideas being drafted in the background, followed until they are done. A
  // page opened while a batch is under way follows that batch too.
  const [pollIds, setPollIds] = useState<string[]>(() =>
    initialIdeas.filter((i) => i.status === 'drafting').map((i) => i.id)
  )
  const [isDrafting, setIsDrafting] = useState(() => pollIds.length > 0)
  // Only a batch started on this page opens the posts when it finishes.
  const [openPostsWhenDone, setOpenPostsWhenDone] = useState(false)
  // The ideas an Approve all / Approve selected is approving: only their cards
  // show it.
  const [approvingIds, setApprovingIds] = useState<string[]>([])
  const isApprovingAll = approvingIds.length > 0
  const [draftStatus, setDraftStatus] = useState<DraftingStatus>(() =>
    pollIds.length > 0 ? 'processing' : 'idle'
  )
  const [draftError, setDraftError] = useState<string | null>(null)
  // The ideas, PAGE_SIZE at a time, by status; a filter change goes back to
  // the first page, and a page past the end shows the last one. The sources,
  // failed steps and discarded ideas page themselves (run-insights).
  const [ideaPage, setIdeaPage] = useState(1)
  const [ideaFilter, setIdeaFilter] = useState<IdeaFilter>('all')
  const ideaListRef = useRef<HTMLElement>(null)
  // The ideas ticked for posts; only ones still at the gate count.
  const [ticked, setTicked] = useState<string[]>([])
  // The ideas behind the latest drafting attempt, so Try again retries exactly those.
  const [draftTargetIds, setDraftTargetIds] = useState<string[]>(pollIds)

  const isRunning = ACTIVE_STATUSES.includes(run.status)

  // Polling while run is active
  useEffect(() => {
    if (!isRunning) return

    const startedAt = Date.now()
    let needFindings = findings.length === 0
    const interval = setInterval(async () => {
      if (Date.now() - startedAt > MAX_POLL_MS) {
        clearInterval(interval)
        return
      }
      // Only the row and its steps while the run moves; everything else
      // once, below, when it stops.
      const res = await pollRunProgress(run.id, needFindings)
      if (!res.success) return
      setSteps(res.steps)
      if (res.findings && res.findings.length > 0) {
        setFindings(res.findings)
        needFindings = false
      }

      if (ACTIVE_STATUSES.includes(res.run.status)) {
        // goalTitles is worked out by fetchRunStatus, not the poll.
        setRun((prev: any) => ({ ...prev, ...res.run }))
        return
      }
      clearInterval(interval)
      const done = await fetchRunStatus(run.id)
      if (done.success && done.run) {
        setRun(done.run)
        setSteps(done.steps)
        setFindings(done.findings)
        setIdeas(done.ideas)
      } else {
        setRun((prev: any) => ({ ...prev, ...res.run }))
      }
      router.refresh()
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
    // findings is read once, when polling starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, run.id, router])

  const [isStopping, setIsStopping] = useState(false)
  const [isReanalyzing, setIsReanalyzing] = useState(false)

  // The run reads stopped at once; the worker running it notices within
  // seconds and cancels what is under way.
  const handleStop = async () => {
    setIsStopping(true)
    try {
      const res = await stopRun(run.id)
      if (!res.success) {
        showToast({ title: 'Could not stop the analysis', message: res.error, type: 'error' })
      }
      // Stopped, or finished meanwhile: either way the page takes the run as it now is.
      const now = await fetchRunStatus(run.id)
      if (now.success && now.run) {
        setRun(now.run)
        setSteps(now.steps)
        setFindings(now.findings)
        setIdeas(now.ideas)
      }
      router.refresh()
    } finally {
      setIsStopping(false)
    }
  }

  // A new run for the same goals; this one, its ideas and their posts stay.
  const handleReanalyze = async () => {
    setIsReanalyzing(true)
    try {
      const res = await reanalyzeRun(run.id)
      if (res.success && res.runId) {
        router.push(`/runs/${res.runId}`)
        return
      }
      showToast({ title: 'Could not re-analyze', message: res.error, type: 'error' })
    } catch (err) {
      // The action catches its own errors, so this is the request itself failing.
      showToast({
        title: 'Could not re-analyze',
        message: err instanceof Error ? err.message : 'The run could not be started.',
        type: 'error'
      })
    }
    setIsReanalyzing(false)
  }

  const [ideaActionBusyId, setIdeaActionBusyId] = useState<string | null>(null)

  // The decision shows at once and is put back if the server refuses it.
  const decideIdea = async (ideaId: string, status: 'approved' | 'rejected') => {
    const previous = ideas.find((i) => i.id === ideaId)?.status
    if (!previous) return
    const setStatus = (next: string) =>
      setIdeas((prev) => prev.map((i) => (i.id === ideaId ? { ...i, status: next } : i)))
    setIdeaActionBusyId(ideaId)
    setStatus(status)
    try {
      const res = status === 'approved' ? await approveIdea(ideaId) : await rejectIdea(ideaId)
      if (!res.success) throw new Error(res.error)
      markDataChanged()
      // The sidebar badge counts ideas still to review.
      if (previous === 'proposed') adjustIdeasToReview(-1)
    } catch (err: any) {
      setStatus(previous)
      showToast({
        title: status === 'approved' ? 'Approve failed' : 'Reject failed',
        message: err?.message || 'Please try again.',
        type: 'error'
      })
    } finally {
      setIdeaActionBusyId(null)
    }
  }

  const handleApproveIdea = (ideaId: string) => decideIdea(ideaId, 'approved')
  const handleRejectIdea = (ideaId: string) => decideIdea(ideaId, 'rejected')

  const handleEditIdeaSave = async (
    ideaId: string,
    payload: { hookConcept: string; angle: string }
  ) => {
    setIdeaActionBusyId(ideaId)
    try {
      const res = await editIdea(ideaId, {
        angle: payload.angle,
        hookConcept: payload.hookConcept
      })
      if (res.success) {
        setIdeas((prev) =>
          prev.map((i) =>
            i.id === ideaId
              ? { ...i, angle: payload.angle, hookConcept: payload.hookConcept }
              : i
          )
        )
        showToast({ title: 'Saved', message: 'Idea edits saved successfully', type: 'success' })
      } else {
        showToast({ title: 'Save failed', message: res.error, type: 'error' })
      }
      return res.success
    } finally {
      setIdeaActionBusyId(null)
    }
  }

  // Approves by the run's own id, so it works whichever account is active.
  const handleApproveAll = async () => {
    const proposedIds = ideas.filter((i) => i.status === 'proposed').map((i) => i.id)
    if (proposedIds.length === 0) return
    setApprovingIds(proposedIds)
    try {
      const res = await approveRunIdeas(run.id, proposedIds)
      if (!res.success) {
        showToast({ title: 'Approve all failed', message: res.error, type: 'error' })
        return
      }
      const approvedIds = res.approvedIds ?? []
      setIdeas((prev) =>
        prev.map((i) => (approvedIds.includes(i.id) ? { ...i, status: 'approved' } : i))
      )
      const failedCount = proposedIds.length - approvedIds.length
      if (failedCount > 0) {
        showToast({
          title: 'Some approvals failed',
          message: `${approvedIds.length} approved, ${failedCount} could not be approved.`,
          type: 'error'
        })
      } else {
        showToast({
          title: 'Approved All',
          message: `Approved ${approvedIds.length} idea${approvedIds.length === 1 ? '' : 's'}.`,
          type: 'success'
        })
      }
    } finally {
      setApprovingIds([])
    }
  }

  const handleApproveSelected = async () => {
    const ids = selection.filter((id) =>
      ideas.some((i) => i.id === id && i.status === 'proposed')
    )
    if (ids.length === 0) return
    setApprovingIds(ids)
    try {
      const res = await approveRunIdeas(run.id, ids)
      if (!res.success) {
        showToast({ title: 'Approve failed', message: res.error, type: 'error' })
        return
      }
      const done = res.approvedIds ?? []
      setIdeas((prev) => prev.map((i) => (done.includes(i.id) ? { ...i, status: 'approved' } : i)))
    } finally {
      setApprovingIds([])
    }
  }

  // Takes the run, and the given ideas, from the server. After a failed
  // attempt some ideas may already be drafted, so putting them all back to
  // approved here would show the wrong thing. Only a batch's own ideas change
  // while it drafts; the others can be approved or edited meanwhile, so they
  // keep what the page shows rather than an answer read before that landed.
  const resyncFromServer = async (ideaIds: string[]) => {
    const res = await fetchRunStatus(run.id)
    if (res.success && res.run) {
      setRun(res.run)
      if (res.ideas) {
        const fresh = new Map<string, any>(res.ideas.map((i: any) => [i.id, i]))
        setIdeas((prev) =>
          prev.map((i) => (ideaIds.includes(i.id) && fresh.get(i.id)) || i)
        )
      }
    }
  }

  // Posts are made only from the given ideas, and of those only approved ones.
  const handleDraftSelected = async (targetIds: string[], formats?: FormatId[]) => {
    const approvedIds = ideas
      .filter((i) => i.status === 'approved' && targetIds.includes(i.id))
      .map((i) => i.id)
    if (approvedIds.length === 0) return
    setDraftTargetIds(approvedIds)
    setLastFormats(formats)

    // The action only queues the ideas and answers at once; the posts are
    // written in the background and followed by useDraftingPoll below. The
    // ideas read "Drafting…" from now on.
    setIsDrafting(true)
    setDraftStatus('processing')
    setDraftError(null)
    setIdeas((prev) =>
      prev.map((i) => (approvedIds.includes(i.id) ? { ...i, status: 'drafting' } : i))
    )

    const fail = async (message: string) => {
      await resyncFromServer(approvedIds).catch(() => {
        setIdeas((prev) =>
          prev.map((i) => (approvedIds.includes(i.id) ? { ...i, status: 'approved' } : i))
        )
      })
      setIsDrafting(false)
      setDraftStatus('error')
      setDraftError(message)
      showToast({ title: 'Drafting failed', message, type: 'error' })
    }

    try {
      const res = await draftSelectedIdeas({
        runId: run.id,
        ideaIds: approvedIds,
        formats,
        imageFormats: formats ? imageFormatsRef.current : undefined,
        carouselFormats: formats ? carouselFormatsRef.current : undefined
      })
      if (!res.success) {
        await fail(res.error || 'Drafting failed. Please try again.')
        return
      }
      setTicked((prev) => prev.filter((id) => !approvedIds.includes(id)))
      // Selected ideas that were not queued (drafted meanwhile, say) show as
      // they are; the note says why.
      await resyncFromServer(approvedIds).catch(() => {})
      if (res.note) {
        showToast({ title: 'Some ideas were skipped', message: res.note, type: 'info' })
      }
      setOpenPostsWhenDone(true)
      setPollIds(res.queuedIds ?? [])
    } catch (err: any) {
      await fail(err?.message || 'Something went wrong while drafting posts.')
    }
  }

  useDraftingPoll(pollIds, {
    onStatuses: (rows) =>
      setIdeas((prev) =>
        prev.map((i) => {
          const row = rows.find((r) => r.id === i.id)
          return row ? { ...i, status: row.status } : i
        })
      ),
    onDone: (rows) => {
      setPollIds([])
      setIsDrafting(false)
      // The run's status and stage list catch up with the finished batch.
      void resyncFromServer(rows.map((r) => r.id)).catch(() => {})
      const drafted = rows.filter((r) => r.status === 'drafted').length
      const notDrafted = rows.length - drafted
      if (drafted === 0) {
        const message = 'No post could be drafted. The ideas are back to approved; try again.'
        setDraftStatus('error')
        setDraftError(message)
        showToast({ title: 'Drafting failed', message, type: 'error' })
        return
      }
      setDraftStatus('success')
      showToast({
        title: 'Posts generated',
        message: `${drafted} post${drafted === 1 ? '' : 's'} drafted and ready for review.${
          notDrafted > 0
            ? ` ${notDrafted} idea${notDrafted === 1 ? '' : 's'} could not be drafted and ${notDrafted === 1 ? 'is' : 'are'} back to approved.`
            : ''
        }`,
        type: 'success'
      })
      if (openPostsWhenDone) router.push(`/posts?runId=${run.id}`)
    }
  })

  const awaitingApproval = run.status === 'awaiting_idea_approval'
  // Ideas can still be waiting after a first batch is drafted, or after a
  // drafting attempt failed part-way, so the run may read "drafting" or
  // "completed" while Approve all and Create posts are still needed.
  const canDecide =
    awaitingApproval ||
    run.status === 'drafting' ||
    run.status === 'completed'
  const statusCount = (status: string) => ideas.filter((i) => i.status === status).length
  const approvedCount = statusCount('approved')
  const proposedCount = statusCount('proposed')
  const draftedCount = statusCount('drafted')
  const isBusy = isDrafting || isApprovingAll

  const selection = ticked.filter((id) =>
    ideas.some((i) => i.id === id && isSelectableIdea(i.status))
  )
  const selectedApproved = selection.filter((id) =>
    ideas.some((i) => i.id === id && i.status === 'approved')
  )
  const selectedProposed = selection.length - selectedApproved.length
  const setTick = (id: string, on: boolean) =>
    setTicked((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)))

  // While the run is active and no step is mid-flight, the first stage with
  // nothing recorded yet is the one starting. Drafting only starts after
  // approval, so it is never inferred here.
  const stepInFlight = isRunning && steps.some((s) => s.status === 'running')
  const nextStageKey = stepInFlight
    ? undefined
    : STAGES.find(({ key }) => key !== 'drafting' && !steps.some((s) => s.stage === key))?.key
  const stages = STAGES.map((stage) => ({
    ...stage,
    ...summarizeStage(stage.key, steps, {
      isRunning,
      isNextStage: stage.key === nextStageKey,
      awaitingApproval
    })
  }))
  const totalDurationMs = stages.reduce((sum, s) => sum + s.durationMs, 0)
  const failedSteps = steps.filter((s) => s.status === 'failed' && s.error)
  // Goals the run was for that lead no idea, with why (see ideation-run).
  const uncoveredGoals: Array<{ goalId: string; goal: string; reason: string }> =
    steps.find((s) => s.stage === 'generating_ideas' && s.status === 'completed')
      ?.responseJson?.uncoveredGoals ?? []

  // What each stage saved (see ideation-run); older runs lack some figures.
  const context = stageData(steps, 'gathering_context')
  const research = stageData(steps, 'researching')
  const ideation = stageData(steps, 'generating_ideas')
  const draftingCount = statusCount('drafting')

  // Drafting ideas count only toward All, as on the Ideas page.
  const ideaCounts: Record<IdeaFilter, number> = {
    proposed: proposedCount,
    approved: approvedCount,
    drafted: draftedCount,
    rejected: statusCount('rejected'),
    all: ideas.length
  }
  const shownIdeas =
    ideaFilter === 'all' ? ideas : ideas.filter((i) => i.status === ideaFilter)
  const { rows: pageIdeas, pageInfo: ideaPageInfo } = paginate(shownIdeas, ideaPage, PAGE_SIZE)

  const goalTitles: string[] =
    run.goalTitles && run.goalTitles.length > 0 ? run.goalTitles : list<string>(context?.goals)
  const platform: PlatformId | null = isPlatformId(run.channel) ? run.channel : null
  const status = runStatusDisplay(run.status)
  const hasProblems = Boolean(run.error) || failedSteps.length > 0 || uncoveredGoals.length > 0
  // The name the run was made under; the identity may have been renamed since.
  const nameAtRun: string =
    typeof context?.account === 'string' && context.account ? context.account : account.name
  const researchNote = [
    typeof research?.mode === 'string' ? research.mode : null,
    typeof research?.fallbackReason === 'string' ? research.fallbackReason : null
  ]
    .filter(Boolean)
    .join(' · ')

  // One accent button at a time: Create posts while ideas are ticked, else
  // Select approved, else Approve all.
  const primaryAction: 'create' | 'select' | 'approve' | null =
    isDrafting || !canDecide
      ? null
      : selection.length > 0
        ? 'create'
        : approvedCount > 0
          ? 'select'
          : proposedCount > 0
            ? 'approve'
            : null

  const showAllIdeas = () => {
    setIdeaFilter('all')
    setIdeaPage(1)
  }

  const reanalyzeButton = (
    <ConfirmPopover
      title="Re-analyze these goals?"
      description="Starts a new run. This one and its ideas stay."
      confirmLabel="Re-analyze"
      tone="neutral"
      onConfirm={handleReanalyze}
      disabled={isReanalyzing}
    >
      <Button className={FOCUS_RING} variant="secondary" size="sm" disabled={isReanalyzing}>
        {isReanalyzing ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
        ) : (
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
        )}
        Re-analyze
      </Button>
    </ConfirmPopover>
  )

  // The run's drafted posts, from the header: the accent button once nothing
  // is left to approve or create.
  const viewPostsButton =
    draftedCount > 0 ? (
      <Link
        href={`/posts?runId=${run.id}`}
        className={buttonClassName({
          variant: primaryAction ? 'secondary' : 'primary',
          size: 'sm',
          className: FOCUS_RING
        })}
      >
        <FileText aria-hidden className="h-3.5 w-3.5" />
        View posts
      </Link>
    ) : null

  const meta = [
    triggerLabel(run.trigger),
    hasMounted && run.createdAt ? <TimeAgo key="time" value={run.createdAt} /> : null,
    platform ? PLATFORMS[platform].name : null,
    !isRunning && totalDurationMs > 0 ? formatDuration(totalDurationMs) : null
  ].filter(Boolean)

  return (
    // Fills the app's main area, top to bottom and edge to edge, as Posts does.
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        // On a phone the buttons take a row of their own, so the title keeps
        // its room instead of being squeezed to nothing beside them.
        wrapActions
        title={
          <div className="flex min-w-0 items-center gap-2.5">
            <h1
              title={goalTitles.length > 2 ? goalTitles.join(', ') : undefined}
              className="text-foreground min-w-0 truncate text-xl font-bold tracking-tight sm:text-2xl"
            >
              {goalTitles.length > 0 ? goalTitles.slice(0, 2).join(', ') : `Run for ${nameAtRun}`}
              {goalTitles.length > 2 && (
                <span className="text-muted font-semibold"> +{goalTitles.length - 2}</span>
              )}
            </h1>
            <StatusChip tone={status.tone} spinning={status.spinning} size="md">
              {status.label}
            </StatusChip>
          </div>
        }
        preTitle={
          <Link
            href="/runs"
            aria-label="Back to all runs"
            className={cn(
              'text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-8 items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-medium transition-colors',
              FOCUS_RING
            )}
          >
            <ArrowLeft aria-hidden className="h-4 w-4" />
            <span className="hidden sm:inline">All runs</span>
          </Link>
        }
        description={
          <span className="tabular-nums">
            {meta.map((part, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden> · </span>}
                {part}
              </span>
            ))}
          </span>
        }
        actions={
          isDrafting ? (
            <span
              aria-busy
              className="bg-accent text-background inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold opacity-75 shadow-sm"
            >
              <Sparkles aria-hidden className="h-3.5 w-3.5 animate-pulse motion-reduce:animate-none" />
              Generating posts…
            </span>
          ) : canDecide && (proposedCount > 0 || approvedCount > 0) ? (
            <>
              {viewPostsButton}
              {proposedCount > 0 && (
                <ConfirmPopover
                  title={`Approve all ${proposedCount} ideas?`}
                  description="No posts are written until you create them."
                  confirmLabel="Approve all"
                  tone="neutral"
                  onConfirm={handleApproveAll}
                  disabled={isBusy}
                >
                  <Button
                    className={FOCUS_RING}
                    variant={primaryAction === 'approve' ? 'primary' : 'secondary'}
                    size="sm"
                    disabled={isBusy}
                  >
                    {isApprovingAll ? (
                      <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <CheckCheck aria-hidden className="h-3.5 w-3.5" />
                    )}
                    <span>Approve all</span>
                  </Button>
                </ConfirmPopover>
              )}
              {approvedCount > 0 && (
                <Button
                  className={FOCUS_RING}
                  variant={primaryAction === 'select' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() =>
                    setTicked(ideas.filter((i) => i.status === 'approved').map((i) => i.id))
                  }
                  disabled={isBusy}
                >
                  <SquareCheck aria-hidden className="h-3.5 w-3.5" />
                  <span>Select approved</span>
                </Button>
              )}
            </>
          ) : (
            viewPostsButton ?? undefined
          )
        }
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="space-y-6">
          <AiDraftingStatus
            status={draftStatus}
            subject={plural(draftTargetIds.length, 'selected idea')}
            successMessage={openPostsWhenDone ? 'Posts ready. Opening them…' : 'Posts ready for review.'}
            errorMessage={draftError}
            onRetry={() => void handleDraftSelected(draftTargetIds, lastFormats)}
            retryDisabled={isDrafting}
          />

          {hasProblems && (
            <ProblemsBanner
              error={run.error ?? null}
              failedSteps={failedSteps}
              uncoveredGoals={uncoveredGoals}
              action={!isRunning ? reanalyzeButton : undefined}
            />
          )}

          {/* Pipeline: one figure per stage is the run's summary */}
          <SectionCard
            title="Pipeline"
            icon={Workflow}
            actions={
              isRunning ? (
                <ConfirmPopover
                  title="Stop this analysis?"
                  description="This run saves no ideas. You can re-analyze it after."
                  confirmLabel="Stop analysis"
                  tone="danger"
                  onConfirm={handleStop}
                  disabled={isStopping}
                >
                  <button
                    type="button"
                    disabled={isStopping}
                    className={cn(
                      'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60',
                      TONES.danger.border,
                      TONES.danger.text,
                      FOCUS_RING
                    )}
                  >
                    {isStopping ? (
                      <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Square aria-hidden className="h-3.5 w-3.5" />
                    )}
                    Stop analysis
                  </button>
                </ConfirmPopover>
              ) : hasProblems ? undefined : (
                // With problems, Re-analyze sits on their banner instead.
                reanalyzeButton
              )
            }
          >
            <ol className="flex flex-col sm:flex-row">
              {stages.map((stage, index) => {
                const look = STAGE_LOOK[stage.state]
                const t = TONES[look.tone]
                const MarkerIcon = look.icon
                const last = index === stages.length - 1
                const figure = stageFigure(stage.key, {
                  context,
                  research,
                  ideation,
                  drafting: draftingCount
                })
                return (
                  <li
                    key={stage.key}
                    aria-current={stage.state === 'running' ? 'step' : undefined}
                    title={stage.runningSummary ?? figure.hover ?? undefined}
                    className="flex min-w-0 gap-3 sm:flex-1 sm:flex-col"
                  >
                    <div aria-hidden className="flex flex-col items-center sm:flex-row">
                      <span
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                          stage.state === 'pending'
                            ? 'border-border text-muted border-dashed'
                            : cn(t.border, t.soft, look.tone === 'neutral' ? 'text-muted' : t.text)
                        )}
                      >
                        {stage.state === 'pending' ? (
                          <stage.icon className="h-3.5 w-3.5" />
                        ) : (
                          <MarkerIcon
                            className={cn(
                              'h-4 w-4',
                              stage.state === 'running' && 'animate-spin motion-reduce:animate-none'
                            )}
                          />
                        )}
                      </span>
                      {!last && (
                        <span
                          className={cn(
                            'my-1 w-px flex-1 sm:mx-2 sm:my-0 sm:h-px sm:w-auto',
                            stage.state === 'completed' ? 'bg-emerald-500/50' : 'bg-border'
                          )}
                        />
                      )}
                    </div>
                    <div className={cn('min-w-0 sm:pr-4', !last && 'pb-5 sm:pb-0')}>
                      <p className="text-foreground text-sm font-semibold">{stage.label}</p>
                      <p
                        className={cn(
                          'text-xs font-medium tabular-nums',
                          look.tone === 'neutral' ? 'text-muted' : t.text
                        )}
                      >
                        {stage.detail}
                      </p>
                      {figure.text && (
                        <p className="text-muted mt-1 text-xs tabular-nums">{figure.text}</p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </SectionCard>

          {/* The ideas: the work to do, above the analytics */}
          {ideas.length > 0 ? (
            <section
              ref={ideaListRef}
              aria-labelledby="run-ideas-heading"
              className="scroll-mt-4 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  id="run-ideas-heading"
                  className="text-foreground flex items-center gap-2 text-sm font-semibold"
                >
                  <Lightbulb aria-hidden className="text-muted h-4 w-4" />
                  Ideas
                </h2>
                <div className="flex items-center gap-1">
                  {draftedCount > 0 && (
                    <Link href={`/posts?runId=${run.id}`} className={QUIET_LINK}>
                      View posts
                    </Link>
                  )}
                  <Link href="/ideas" className={QUIET_LINK}>
                    Open in Ideas
                    <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>

              <FilterChips
                label="Show this run's ideas by status"
                value={ideaFilter}
                onChange={(next) => {
                  setIdeaFilter(next)
                  setIdeaPage(1)
                }}
                className="w-fit max-w-full"
                options={IDEA_FILTERS.map((value) => ({
                  value,
                  label: IDEA_FILTER_LABELS[value],
                  count: ideaCounts[value],
                  tone: IDEA_FILTER_TONES[value]
                }))}
              />

              {pageIdeas.length === 0 ? (
                <EmptyState
                  compact
                  icon={Filter}
                  title="No ideas here"
                  action={
                    <Button
                      className={FOCUS_RING}
                      variant="secondary"
                      size="sm"
                      onClick={showAllIdeas}
                    >
                      Show all
                    </Button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                  {pageIdeas.map((idea) => (
                    <RunIdeaCard
                      key={idea.id}
                      idea={idea}
                      onApprove={handleApproveIdea}
                      onReject={handleRejectIdea}
                      onEditSave={handleEditIdeaSave}
                      // Only the card's own action, or a bulk approve that
                      // includes it. Drafting ideas show it in their status and
                      // have no actions; the rest stay usable meanwhile.
                      isBusy={ideaActionBusyId === idea.id || approvingIds.includes(idea.id)}
                      selected={selection.includes(idea.id)}
                      onSelectChange={canDecide ? setTick : undefined}
                    />
                  ))}
                </div>
              )}
              <Pagination
                {...ideaPageInfo}
                noun="ideas"
                onPageChange={setIdeaPage}
                scrollTarget={ideaListRef}
              />
            </section>
          ) : (
            isRunning && (
              <EmptyState
                compact
                icon={Hourglass}
                tone="brand"
                title="No ideas yet"
                description="They appear when ideation finishes."
              />
            )
          )}

          <EvidenceSection
            research={research}
            findings={findings}
            accountSite={account?.websiteUrl ?? null}
          />

          {ideation && <IdeaQualitySection ideation={ideation} />}

          <RunCostPanel
            steps={steps}
            draftCount={
              steps.filter((s) => s.stage === 'drafting' && s.status === 'completed').length
            }
            legacyCostUsd={run.costUsd}
          />

          {/* Settings frozen at run start, for auditing */}
          <details className="group border-border bg-surface rounded-2xl border shadow-xs">
            <summary
              className={cn(
                'text-foreground flex cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 py-3.5 text-sm font-semibold sm:px-5 [&::-webkit-details-marker]:hidden',
                FOCUS_RING
              )}
            >
              Run configuration
              <ChevronDown
                aria-hidden
                className="text-muted h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
                <dt className="text-muted">Run ID</dt>
                <dd className="text-foreground font-mono break-all">{run.id}</dd>
                <dt className="text-muted">Trigger</dt>
                <dd className="text-foreground">{run.trigger}</dd>
                <dt className="text-muted">Identity</dt>
                <dd className="text-foreground">{nameAtRun}</dd>
                <dt className="text-muted">Platform</dt>
                <dd className="text-foreground">{platform ? PLATFORMS[platform].name : 'All'}</dd>
                {run.createdAt && (
                  <>
                    <dt className="text-muted">Started</dt>
                    <dd className="text-foreground">
                      <TimeAgo value={run.createdAt} absolute />
                    </dd>
                  </>
                )}
                {researchNote && (
                  <>
                    <dt className="text-muted">Research</dt>
                    <dd className="text-foreground wrap-break-word">{researchNote}</dd>
                  </>
                )}
                {typeof ideation?.model === 'string' && (
                  <>
                    <dt className="text-muted">Model</dt>
                    <dd className="text-foreground font-mono break-all">{ideation.model}</dd>
                  </>
                )}
              </dl>
              <pre className="bg-surface-hover/60 text-foreground max-h-64 overflow-x-auto rounded-xl p-4 font-mono text-xs">
                {JSON.stringify(
                  {
                    researchConfig: run.researchConfig,
                    mediaConfig: run.mediaConfig,
                    timings: run.timings
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          </details>

          {/* With ideas ticked, posts are made from the selection only. */}
          {canDecide && selection.length > 0 && !isDrafting && (
            <div className="pointer-events-none sticky bottom-0 z-20 pt-2">
              <div
                role="region"
                aria-label="Selected ideas"
                className="border-border bg-surface pointer-events-auto mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border p-2 pl-4 shadow-lg"
              >
                <p className="text-foreground text-sm font-medium tabular-nums">
                  {selection.length} selected
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTicked([])}
                    aria-label={`Clear selection (${selection.length} selected)`}
                    className={cn(
                      'text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg',
                      FOCUS_RING
                    )}
                  >
                    <X aria-hidden className="h-4 w-4" />
                  </button>
                  {selectedProposed > 0 && (
                    <Button
                      className={FOCUS_RING}
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleApproveSelected()}
                      disabled={isBusy}
                    >
                      {isApprovingAll ? (
                        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                      ) : (
                        <CheckCheck aria-hidden className="h-3.5 w-3.5" />
                      )}
                      <span>Approve {selectedProposed}</span>
                    </Button>
                  )}
                  <Button
                    className={FOCUS_RING}
                    size="sm"
                    onClick={() => setCreateDialogOpen(true)}
                    disabled={isBusy || selectedApproved.length === 0}
                    title={
                      selectedApproved.length === 0
                        ? 'Approve the selected ideas first'
                        : undefined
                    }
                  >
                    <Sparkles aria-hidden className="h-3.5 w-3.5" />
                    <span>{`Create ${selectedApproved.length} post${selectedApproved.length === 1 ? '' : 's'}`}</span>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {createDialogOpen && (
        <CreatePostsDialog
          title={`Create ${selectedApproved.length} post${selectedApproved.length === 1 ? '' : 's'}`}
          description={`Pick platforms and post types.${
            selectedProposed > 0 ? ` ${selectedProposed} unapproved left out.` : ''
          }`}
          suggested={ideas
            .filter((i) => selectedApproved.includes(i.id))
            .flatMap((i) => i.formatFit ?? [])}
          enabledFormats={enabledFormats}
          confirmLabel="Create posts"
          onCancel={() => setCreateDialogOpen(false)}
          onConfirm={(formats, imageFormats, carouselFormats) => {
            setCreateDialogOpen(false)
            imageFormatsRef.current = imageFormats
            carouselFormatsRef.current = carouselFormats
            void handleDraftSelected(selection, formats)
          }}
        />
      )}
    </div>
  )
}
