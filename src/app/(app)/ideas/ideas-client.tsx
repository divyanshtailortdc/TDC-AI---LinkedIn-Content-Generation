'use client'

import {
  Fragment,
  useEffect,
  useOptimistic,
  startTransition,
  useRef,
  useState,
  useTransition
} from 'react'
import { markDataChanged } from '@/components/refresh-on-back'
import { adjustIdeasToReview } from '@/lib/ideas-badge'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Sparkles, ArrowRight, Check, CheckCheck, SquareCheck, Wand2, X } from 'lucide-react'
import { IdeaCardData } from '@/components/idea-card'
import { CreatePostsDialog } from '@/components/create-posts-dialog'
import { PLATFORMS, type FormatId, type PlatformId } from '@/lib/formats'
import { GenerateRunDialog, type RunPickerData } from '@/components/generate-run-dialog'
import { PlatformTabs } from '@/components/platform-tabs'
import { IDEA_STATUS_LABEL, isSelectableIdea, RunIdeaCard } from '@/components/run-idea-card'
import { PageHeader } from '@/components/page-header'
import { AiDraftingStatus, type DraftingStatus } from '@/components/ai-drafting-status'
import { approveIdea, rejectIdea, editIdea, draftSelectedIdeas, approveAllIdeas } from './actions'
import { showToast } from '@/components/toast-notification'
import { ConfirmPopover } from '@/components/confirm-popover'
import { StatusFilterMenu } from '@/components/status-filter-menu'
import { Pagination } from '@/components/pagination'
import { cn } from '@/lib/cn'
import { formatAbsoluteDateTime } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import type { IdentitySummary } from '@/lib/identity'
import type { PageInfo } from '@/lib/pagination'
import { STATUS_TABS, type StatusFilter } from './status-filter'
import { useDraftingPoll } from './use-drafting-poll'

type ClientIdeaData = IdeaCardData & {
  accountId: string
  runId?: string | null
  runCreatedAt?: Date | string | null
  /** The identity's name when the run started. */
  runAccountName?: string | null
  /** The goals the run was started for. */
  runGoalTitles?: string[] | null
}

const statusLabel = (status: StatusFilter) =>
  status === 'all' ? 'All statuses' : IDEA_STATUS_LABEL[status]

const EMPTY_STATE: Record<StatusFilter, { title: string; body: string }> = {
  proposed: {
    title: 'Nothing waiting for review',
    body: 'Start a run to generate new grounded ideas.'
  },
  approved: {
    title: 'No approved ideas',
    body: 'Approve ideas from To review, then select them to draft posts.'
  },
  drafted: {
    title: 'No drafted ideas',
    body: 'Ideas turned into posts show up here.'
  },
  rejected: { title: 'No rejected ideas', body: 'Ideas you reject show up here.' },
  all: { title: 'No ideas yet', body: 'Start a run to generate grounded ideas.' }
}

export function IdeasClient({
  initialIdeas,
  pageInfo,
  status,
  statusCounts,
  proposedIds,
  approvedIds,
  identity,
  platform = null,
  platformOptions = [],
  platformCounts,
  enabledFormats,
  picker
}: {
  /** One page of the ideas the status filter shows; pageInfo says which. */
  initialIdeas: ClientIdeaData[]
  pageInfo: PageInfo
  status: StatusFilter
  statusCounts: Record<StatusFilter, number>
  /** Every idea waiting for review, on any page. */
  proposedIds: string[]
  /** Every approved idea not yet drafted, on any page. */
  approvedIds: string[]
  identity: IdentitySummary
  /** The one platform whose ideas are shown; null for every platform. */
  platform?: PlatformId | null
  /** The platforms with a tab: those posted on, or with ideas. */
  platformOptions?: PlatformId[]
  /** How many ideas each platform tab holds under the status filter. */
  platformCounts?: { all: number; byPlatform: Partial<Record<PlatformId, number>> }
  /** The formats the identity writes: all Create posts offers. */
  enabledFormats: FormatId[]
  /** For Generate ideas: the goals and platforms a run can be for. */
  picker?: RunPickerData
}) {
  const router = useRouter()
  const pathname = usePathname()
  // Creating posts asks first which platforms and types of post to write
  // (CreatePostsDialog); the last answer is kept for Try again.
  const [createDialog, setCreateDialog] = useState<
    | { kind: 'selected' }
    | { kind: 'approve' }
    | { kind: 'single'; id: string }
    | null
  >(null)
  const [lastFormats, setLastFormats] = useState<FormatId[] | undefined>()
  // The formats ticked "Add an image" in Create posts, sent with the formats
  // (runDrafting) and kept for Try again, as lastFormats is.
  const imageFormatsRef = useRef<FormatId[] | undefined>(undefined)
  const [ideas, setIdeas] = useState<ClientIdeaData[]>(initialIdeas)
  // The server sends a new page after every action here (each revalidates
  // /ideas) and on each page or filter change. It replaces the local copy,
  // which only holds the optimistic changes made until it arrives. Adjusted
  // during render, as on the Posts page, so the old list never paints.
  const [shownIdeas, setShownIdeas] = useState(initialIdeas)
  if (initialIdeas !== shownIdeas) {
    setShownIdeas(initialIdeas)
    setIdeas(initialIdeas)
  }
  // A page past the end, such as the last page once its ideas have all moved
  // out of the filter, is served as the last page. The URL follows, so a
  // reload, Back and the page numbers all agree on where the list is.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const shown = pageInfo.page > 1 ? String(pageInfo.page) : null
    if (params.get('page') === shown) return
    if (shown) params.set('page', shown)
    else params.delete('page')
    const query = params.toString()
    window.history.replaceState(null, '', query ? `?${query}` : pathname)
  }, [pageInfo.page, pathname])

  // The filter is loaded on the server, so the menu shows the new choice
  // while that page loads.
  const [isFiltering, startFiltering] = useTransition()
  const [selectedStatus, setSelectedStatus] = useOptimistic(status)
  const [selectedPlatform, setSelectedPlatform] = useOptimistic(platform)
  // Status and platform both live in the URL. Defaults ('all', every
  // platform) are left out, and a new filter starts on its first page.
  const filterQuery = (next: { status: StatusFilter; platform: PlatformId | null }) => {
    const query: Record<string, string> = {}
    if (next.status !== 'all') query.status = next.status
    if (next.platform) query.platform = next.platform
    return query
  }
  const pushFilters = (next: { status: StatusFilter; platform: PlatformId | null }) => {
    const query = new URLSearchParams(filterQuery(next)).toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }
  const changeStatus = (next: StatusFilter) =>
    startFiltering(() => {
      setSelectedStatus(next)
      pushFilters({ status: next, platform })
    })
  const changePlatform = (next: PlatformId | null) =>
    startFiltering(() => {
      setSelectedPlatform(next)
      // A selection made on one platform's ideas does not carry over.
      setTicked([])
      pushFilters({ status, platform: next })
    })
  const platformLabel = platform ? PLATFORMS[platform].label : null
  // Generate ideas opens the run picker, starting on the platform shown.
  const [generateOpen, setGenerateOpen] = useState(false)
  const [isActionBusy, setIsActionBusy] = useState(false)
  const draftingRef = useRef(false)
  const [ideaActionBusyId, setIdeaActionBusyId] = useState<string | null>(null)
  const [draftStatus, setDraftStatus] = useState<DraftingStatus>('idle')
  const [draftError, setDraftError] = useState<string | null>(null)
  // The ideas behind the latest drafting attempt, so Try again retries exactly those.
  const [draftTargetIds, setDraftTargetIds] = useState<string[]>([])
  // Ideas being drafted in the background, followed until they are done. One
  // left drafting by an earlier visit is followed too, quietly: only a batch
  // started here shows progress and opens the posts.
  const [pollIds, setPollIds] = useState<string[]>(() =>
    initialIdeas.filter((i) => i.status === 'drafting').map((i) => i.id)
  )
  const [openPostsWhenDone, setOpenPostsWhenDone] = useState(false)
  const isDrafting = draftStatus === 'processing'
  // While posts are being generated (and until we navigate to them), only the
  // progress panel is shown — the ideas list would just be noise.
  const showGeneratingOnly = draftStatus === 'processing' || draftStatus === 'success'

  // The ideas ticked for posts. Kept across pages and filters; only ideas
  // still to review or approved count, so one drafted or rejected since
  // drops out on its own.
  const [ticked, setTicked] = useState<string[]>([])
  const selection = ticked.filter(
    (id) => proposedIds.includes(id) || approvedIds.includes(id)
  )
  const selectedApproved = selection.filter((id) => approvedIds.includes(id))
  const selectedProposed = selection.filter((id) => proposedIds.includes(id))
  const setTick = (id: string, on: boolean) =>
    setTicked((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)))
  const clearSelection = () => setTicked([])

  // All ideas here already belong to the active account (scoped server-side)
  // and match the filter; this hides ones an action has just moved out of it
  // until the server's next page arrives.
  const filteredIdeas = ideas.filter(
    (idea) => status === 'all' || idea.status === status
  )

  // The ideas on screen that can be ticked, for "Select shown".
  const selectableShown = filteredIdeas
    .filter((i) => isSelectableIdea(i.status))
    .map((i) => i.id)
  const allShownTicked =
    selectableShown.length > 0 && selectableShown.every((id) => selection.includes(id))

  // Ideas come in batches, one per run. Once the list holds more than one, or
  // a batch made under another name, each batch gets a heading.
  const showRunHeaders =
    new Set(filteredIdeas.map(i => i.runId)).size > 1 ||
    filteredIdeas.some(
      i => i.runAccountName && i.runAccountName !== identity.name
    )

  const approvedCount = approvedIds.length
  const allProposedIds = proposedIds

  // The tabs, counts and selections come from the server, so the page is
  // refreshed after decisions, in the background: once none is still being
  // saved, so a refresh never overwrites one in flight, and once for a burst.
  const decisionsInFlight = useRef(0)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
  }, [])
  const refreshAfterDecisions = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      if (decisionsInFlight.current === 0) startTransition(() => router.refresh())
    }, 600)
  }

  // The decision shows at once and is put back if the server refuses it.
  const decideIdea = async (id: string, status: 'approved' | 'rejected') => {
    const previous = ideas.find((i) => i.id === id)?.status
    if (!previous) return
    const setStatus = (next: string) =>
      setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status: next } : i)))
    setIdeaActionBusyId(id)
    setStatus(status)
    decisionsInFlight.current++
    try {
      const res = status === 'approved' ? await approveIdea(id) : await rejectIdea(id)
      if (!res.success) throw new Error(res.error)
      markDataChanged()
      // The sidebar badge counts ideas still to review.
      if (previous === 'proposed') adjustIdeasToReview(-1)
      showToast(
        status === 'approved'
          ? { title: 'Approved', message: 'Idea successfully approved', type: 'success' }
          : { title: 'Rejected', message: 'Idea rejected', type: 'info' }
      )
    } catch (err: any) {
      setStatus(previous)
      showToast({
        title: status === 'approved' ? 'Approve failed' : 'Reject failed',
        message: err?.message || 'Please try again.',
        type: 'error'
      })
    } finally {
      decisionsInFlight.current--
      setIdeaActionBusyId(null)
      refreshAfterDecisions()
    }
  }

  const handleApprove = (id: string) => decideIdea(id, 'approved')

  const handleApproveAll = async () => {
    if (allProposedIds.length === 0) return
    setIsActionBusy(true)
    try {
      const res = await approveAllIdeas(allProposedIds)
      if (res.success) {
        // Only what the server actually approved, which can be fewer than were
        // sent if some ideas were drafted elsewhere since this list loaded.
        const approvedIds = res.approvedIds ?? []
        setIdeas((prev) =>
          prev.map((i) => (approvedIds.includes(i.id) ? { ...i, status: 'approved' } : i))
        )
        const skippedCount = allProposedIds.length - approvedIds.length
        if (skippedCount > 0) {
          showToast({
            title: 'Some ideas not approved',
            message: `${approvedIds.length} approved, ${skippedCount} could not be approved. Refresh the page to see their current status.`,
            type: 'error'
          })
        } else {
          showToast({
            title: 'Approved All',
            message: `Approved ${approvedIds.length} idea${approvedIds.length === 1 ? '' : 's'}.`,
            type: 'success'
          })
        }
      } else {
        showToast({ title: 'Approve all failed', message: res.error, type: 'error' })
      }
    } finally {
      setIsActionBusy(false)
    }
  }

  const handleReject = (id: string) => decideIdea(id, 'rejected')

  const handleEditSave = async (id: string, payload: { hookConcept: string; angle: string }) => {
    setIdeaActionBusyId(id)
    try {
      const res = await editIdea(id, {
        angle: payload.angle,
        hookConcept: payload.hookConcept
      })
      if (res.success) {
        setIdeas((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, angle: payload.angle, hookConcept: payload.hookConcept } : i
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

  // Approving and drafting are one operation at a time. Several clicks in the
  // same tick all run before the busy state renders and disables the button;
  // the ref turns the extras away straight away. Whoever takes it must be the
  // one to release it.
  const draftIdeas = async (targetIds: string[], formats?: FormatId[]) => {
    if (targetIds.length === 0 || draftingRef.current) return
    draftingRef.current = true
    try {
      await runDrafting(targetIds, formats)
    } finally {
      draftingRef.current = false
    }
  }

  // Queues the ideas for drafting. The caller holds draftingRef. The action
  // answers at once; the posts are written in the background and followed by
  // useDraftingPoll below.
  const runDrafting = async (targetIds: string[], formats?: FormatId[]) => {
    setIsActionBusy(true)
    setLastFormats(formats)
    setDraftStatus('processing')
    setDraftError(null)
    setDraftTargetIds(targetIds)
    setIdeas((prev) => prev.map((i) => (targetIds.includes(i.id) ? { ...i, status: 'drafting' } : i)))

    try {
      const res = await draftSelectedIdeas({
        ideaIds: targetIds,
        formats,
        imageFormats: formats ? imageFormatsRef.current : undefined
      })
      if (res.success) {
        setTicked((prev) => prev.filter((id) => !targetIds.includes(id)))
        if (res.note) {
          showToast({ title: 'Some ideas were skipped', message: res.note, type: 'info' })
        }
        setOpenPostsWhenDone(true)
        setPollIds(res.queuedIds ?? [])
      } else {
        // Roll the optimistic update back — drafting failed, so these ideas
        // are still just approved, not drafted.
        setIdeas((prev) =>
          prev.map((i) => (targetIds.includes(i.id) ? { ...i, status: 'approved' } : i))
        )
        setDraftStatus('error')
        setDraftError(res.error || 'Drafting failed. Please try again.')
        showToast({
          title: 'Drafting failed',
          message: res.error || 'Drafting failed. Please try again.',
          type: 'error'
        })
      }
    } catch (err: any) {
      setIdeas((prev) =>
        prev.map((i) => (targetIds.includes(i.id) ? { ...i, status: 'approved' } : i))
      )
      setDraftStatus('error')
      setDraftError(err?.message || 'Something went wrong while drafting posts.')
      showToast({
        title: 'Drafting failed',
        message: err?.message || 'Something went wrong while drafting posts.',
        type: 'error'
      })
    } finally {
      setIsActionBusy(false)
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
      const drafted = rows.filter((r) => r.status === 'drafted').length
      const notDrafted = rows.length - drafted
      if (!openPostsWhenDone) {
        // A batch started elsewhere: the page's lists and counts catch up.
        router.refresh()
        return
      }
      if (drafted === 0) {
        const message = 'No post could be drafted. The ideas are back to approved; try again.'
        setDraftStatus('error')
        setDraftError(message)
        showToast({ title: 'Drafting failed', message, type: 'error' })
        router.refresh()
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
      router.push('/posts')
    }
  })

  // Posts are made only from the selected ideas that are approved.
  const handleDraftSelected = async (formats: FormatId[]) => {
    await draftIdeas(selectedApproved, formats)
  }

  const handleApproveSelected = async () => {
    if (selectedProposed.length === 0) return
    setIsActionBusy(true)
    try {
      const res = await approveAllIdeas(selectedProposed)
      if (res.success) {
        const done = res.approvedIds ?? []
        setIdeas((prev) => prev.map((i) => (done.includes(i.id) ? { ...i, status: 'approved' } : i)))
        showToast({
          title: 'Approved',
          message: `Approved ${done.length} selected idea${done.length === 1 ? '' : 's'}.`,
          type: 'success'
        })
      } else {
        showToast({ title: 'Approve failed', message: res.error, type: 'error' })
      }
    } finally {
      setIsActionBusy(false)
    }
  }

  // One click: approve the selected ideas still waiting for review, then draft
  // posts for every selected idea that is now approved. Nothing outside the
  // selection is approved or drafted.
  const handleApproveSelectedAndDraft = async (formats: FormatId[]) => {
    const alreadyApprovedIds = selectedApproved
    const toApprove = selectedProposed
    if (toApprove.length === 0 || draftingRef.current) return
    draftingRef.current = true

    try {
      setIsActionBusy(true)
      setDraftStatus('processing')
      setDraftError(null)
      let approvedNow: string[] | null = null
      try {
        const res = await approveAllIdeas(toApprove)
        if (res.success) {
          approvedNow = res.approvedIds ?? []
          const done = approvedNow
          setIdeas((prev) =>
            prev.map((i) => (done.includes(i.id) ? { ...i, status: 'approved' } : i))
          )
        } else {
          showToast({ title: 'Approve all failed', message: res.error, type: 'error' })
        }
      } catch (err: any) {
        showToast({
          title: 'Approve all failed',
          message: err?.message || 'Something went wrong while approving ideas.',
          type: 'error'
        })
      }

      if (!approvedNow) {
        setIsActionBusy(false)
        setDraftStatus('idle')
        return
      }
      // Stays busy straight through into drafting, which clears it when done.
      await runDrafting([...alreadyApprovedIds, ...approvedNow], formats)
    } finally {
      draftingRef.current = false
    }
  }

  // An idea's own Create post asks for the platform and type first.
  const handleDraftSingle = async (id: string) => {
    setCreateDialog({ kind: 'single', id })
  }

  const draftSingle = async (id: string, formats: FormatId[]) => {
    setIdeaActionBusyId(id)
    try {
      await draftIdeas([id], formats)
    } finally {
      setIdeaActionBusyId(null)
    }
  }

  // The ideas the open dialog creates posts from, and what it says.
  const dialogTargetIds =
    createDialog?.kind === 'single'
      ? [createDialog.id]
      : createDialog?.kind === 'approve'
        ? selection
        : selectedApproved
  const dialogPosts = `${dialogTargetIds.length} post${dialogTargetIds.length === 1 ? '' : 's'}`
  const confirmCreate = (formats: FormatId[], imageFormats: FormatId[]) => {
    const open = createDialog
    setCreateDialog(null)
    imageFormatsRef.current = imageFormats
    // Not awaited: drafting shows its own progress.
    if (open?.kind === 'single') void draftSingle(open.id, formats)
    else if (open?.kind === 'approve') void handleApproveSelectedAndDraft(formats)
    else void handleDraftSelected(formats)
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Idea Review & Approval"
        description={`Review ${platformLabel ? `${platformLabel} ` : ''}post ideas for ${identity.name}`}
        actions={
          isDrafting ? (
            <span
              aria-busy
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-background opacity-75 shadow-sm"
            >
              <Sparkles className="h-3.5 w-3.5 animate-pulse" />
              Generating posts…
            </span>
          ) : showGeneratingOnly ? null : selection.length > 0 ? (
            // With ideas ticked, every action works on the selection only.
            <>
              <span className="text-foreground inline-flex h-8 items-center gap-1 text-[13px] font-medium tabular-nums">
                {/* Phones show just the number so the row stays one line. */}
                <span>
                  {selection.length}
                  <span className="hidden sm:inline"> selected</span>
                </span>
                <button
                  type="button"
                  onClick={clearSelection}
                  aria-label={`Clear selection (${selection.length} selected)`}
                  className="text-muted hover:text-foreground hover:bg-surface-hover ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>

              {selectedProposed.length > 0 && (
                <button
                  type="button"
                  onClick={handleApproveSelected}
                  disabled={isActionBusy}
                  className="inline-flex cursor-pointer h-8 items-center gap-1.5 rounded-lg border border-accent/30 px-3.5 text-[13px] font-semibold text-accent transition-colors hover:bg-accent/10 disabled:opacity-60"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  <span>Approve</span>
                </button>
              )}

              {selectedProposed.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setCreateDialog({ kind: 'selected' })}
                  disabled={isActionBusy}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-background shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{`Create ${selectedApproved.length} post${selectedApproved.length === 1 ? '' : 's'}`}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                // The dialog says what is approved first and asks for the platforms.
                <button
                  type="button"
                  onClick={() => setCreateDialog({ kind: 'approve' })}
                  disabled={isActionBusy}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-background shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Approve &amp; Create Posts</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          ) : (
            <>
              {picker && (
                <button
                  type="button"
                  onClick={() => setGenerateOpen(true)}
                  aria-label={platformLabel ? `Generate ${platformLabel} ideas` : 'Generate ideas'}
                  className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors sm:px-3.5"
                >
                  <Wand2 className="text-accent h-3.5 w-3.5" />
                  {/* Icon only on phones, so the header's buttons stay on one row. */}
                  <span className="hidden sm:inline">
                    {platformLabel ? `Generate ${platformLabel} ideas` : 'Generate ideas'}
                  </span>
                </button>
              )}
              {allProposedIds.length > 0 && (
                <ConfirmPopover
                  title={`Approve all ${allProposedIds.length} ${platformLabel ? `${platformLabel} ` : ''}ideas?`}
                  description={
                    platformLabel
                      ? `Every ${platformLabel} idea waiting for review moves to Approved; other platforms' ideas are left alone. No posts are written until you select ideas and create them.`
                      : 'Every idea waiting for review moves to Approved. No posts are written until you select ideas and create them.'
                  }
                  confirmLabel="Approve all"
                  tone="neutral"
                  onConfirm={handleApproveAll}
                  disabled={isActionBusy}
                >
                  <button
                    type="button"
                    disabled={isActionBusy}
                    className="inline-flex cursor-pointer h-8 items-center gap-1.5 rounded-lg border border-accent/30 px-3.5 text-[13px] font-semibold text-accent transition-colors hover:bg-accent/10 disabled:opacity-60"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    <span>Approve all ({allProposedIds.length})</span>
                  </button>
                </ConfirmPopover>
              )}

              {approvedCount > 0 && (
                // Picks the approved ideas; posts are created from the selection.
                <button
                  type="button"
                  onClick={() => setTicked(approvedIds)}
                  disabled={isActionBusy}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-background shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <SquareCheck className="h-3.5 w-3.5" />
                  <span>Select {approvedCount} approved</span>
                </button>
              )}
            </>
          )
        }
        bottomContent={
          showGeneratingOnly ? undefined : (
            <div className="space-y-3">
              {platformOptions.length > 1 && (
                <PlatformTabs
                  label="Show ideas for one platform"
                  options={platformOptions}
                  value={selectedPlatform}
                  onChange={changePlatform}
                  counts={platformCounts}
                />
              )}
              <div className="flex items-center gap-3">
                <StatusFilterMenu
                  value={selectedStatus}
                  options={STATUS_TABS}
                  label={statusLabel}
                  counts={statusCounts}
                  onChange={changeStatus}
                />
                {selectableShown.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      allShownTicked
                        ? setTicked((prev) => prev.filter((id) => !selectableShown.includes(id)))
                        : setTicked((prev) => [...new Set([...prev, ...selectableShown])])
                    }
                    className="text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors"
                  >
                    <SquareCheck className="h-3.5 w-3.5" />
                    {allShownTicked ? 'Unselect shown' : 'Select shown'}
                  </button>
                )}
                <p className="text-muted hidden shrink-0 text-xs md:block">
                  Posts are written only from selected ideas that are approved.
                </p>
              </div>
            </div>
          )
        }
      />

      {/* Scrollable ideas list */}
      <div className="relative flex-1 overflow-y-auto p-4 sm:px-6 sm:pb-5">
        <div className="w-full space-y-4">
          <AiDraftingStatus
            status={draftStatus}
            subject={
              draftTargetIds.length > 0
                ? `${draftTargetIds.length} approved idea${draftTargetIds.length === 1 ? '' : 's'}`
                : 'your ideas'
            }
            errorMessage={draftError}
            onRetry={() => void draftIdeas(draftTargetIds, lastFormats)}
            retryDisabled={isActionBusy}
          />

          {showGeneratingOnly ? null : filteredIdeas.length === 0 ? (
            <div
              className={cn(
                'rounded-2xl border-2 border-dashed border-border bg-surface p-12 text-center transition-opacity',
                isFiltering && 'opacity-60'
              )}
            >
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted" />
              <h3 className="text-sm font-semibold text-foreground">
                {platformLabel
                  ? `${EMPTY_STATE[status].title} for ${platformLabel}`
                  : EMPTY_STATE[status].title}
              </h3>
              <p className="mx-auto mt-1 mb-5 max-w-sm text-xs leading-relaxed text-muted">
                {platformLabel && (status === 'all' || status === 'proposed')
                  ? `Generate ideas made for ${platformLabel} and what works there, or look at every platform's ideas.`
                  : EMPTY_STATE[status].body}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {picker && (
                  <button
                    type="button"
                    onClick={() => setGenerateOpen(true)}
                    className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-background transition-colors hover:bg-accent-hover"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    {platformLabel ? `Generate ${platformLabel} ideas` : 'Generate ideas'}
                  </button>
                )}
                {platform ? (
                  <button
                    type="button"
                    onClick={() => changePlatform(null)}
                    className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-medium transition-colors"
                  >
                    All platforms
                  </button>
                ) : (
                  <Link
                    href="/runs"
                    className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-8 items-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-medium transition-colors"
                  >
                    View Runs
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div
              aria-busy={isFiltering}
              className={cn(
                'grid grid-cols-1 items-start gap-4 lg:grid-cols-2 transition-opacity',
                isFiltering && 'opacity-60'
              )}
            >
              {filteredIdeas.map((idea, index) => (
                <Fragment key={idea.id}>
                  {showRunHeaders &&
                    idea.runId !== filteredIdeas[index - 1]?.runId && (
                      <RunGroupHeader
                        idea={idea}
                        currentName={identity.name}
                      />
                    )}
                  <RunIdeaCard
                    idea={idea}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onEditSave={handleEditSave}
                    onDraft={handleDraftSingle}
                    isBusy={ideaActionBusyId === idea.id}
                    showStatus={status === 'all'}
                    selected={selection.includes(idea.id)}
                    onSelectChange={setTick}
                  />
                </Fragment>
              ))}
            </div>
          )}

          {!showGeneratingOnly && (
            <div className="pt-2 pb-8">
              <Pagination
                {...pageInfo}
                noun="ideas"
                query={filterQuery({ status, platform })}
              />
            </div>
          )}
        </div>
      </div>

      {picker && (
        <GenerateRunDialog
          open={generateOpen}
          onClose={() => setGenerateOpen(false)}
          picker={picker}
          initialChannel={platform}
        />
      )}

      {createDialog && (
        <CreatePostsDialog
          title={
            createDialog.kind === 'approve'
              ? `Approve and create ${dialogPosts}`
              : `Create ${dialogPosts}`
          }
          description={
            createDialog.kind === 'approve'
              ? `The ${selectedProposed.length} selected idea${selectedProposed.length === 1 ? ' still to review is' : 's still to review are'} approved first. Choose where the posts go and what type of post to write. Ideas you did not select are left alone.`
              : `Choose where the post${dialogTargetIds.length === 1 ? '' : 's'} go and what type of post to write.`
          }
          suggested={ideas
            .filter((i) => dialogTargetIds.includes(i.id))
            .flatMap((i) => i.formatFit ?? [])}
          enabledFormats={enabledFormats}
          initialPlatforms={platform ? [platform] : undefined}
          confirmLabel={
            createDialog.kind === 'approve' ? 'Approve & create' : 'Create posts'
          }
          onCancel={() => setCreateDialog(null)}
          onConfirm={confirmCreate}
        />
      )}
    </div>
  )
}

/** Heading above the ideas of one run: when it ran, as whom, and for which goal. */
function RunGroupHeader({
  idea,
  currentName
}: {
  idea: ClientIdeaData
  currentName: string
}) {
  const mounted = useHasMounted()
  const ranAs = idea.runAccountName
  const renamed = Boolean(ranAs && ranAs !== currentName)

  return (
    <div className="border-border col-span-full mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-2 first:mt-0">
      <span className="text-foreground text-xs font-semibold">
        {idea.runCreatedAt
          ? mounted
            ? `Run of ${formatAbsoluteDateTime(idea.runCreatedAt)}`
            : 'Run'
          : 'Earlier ideas'}
      </span>
      {ranAs && (
        <span
          title={
            renamed
              ? `This run was made when the identity was named ${ranAs}. It is named ${currentName} now.`
              : undefined
          }
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-semibold',
            renamed
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
              : 'bg-surface-hover text-muted'
          )}
        >
          {renamed ? `Made as ${ranAs}` : ranAs}
        </span>
      )}
      {idea.runGoalTitles && idea.runGoalTitles.length > 0 && (
        <span
          title={idea.runGoalTitles.join(', ')}
          className="text-muted min-w-0 truncate text-[11px]"
        >
          {idea.runGoalTitles.length === 1 ? 'Goal' : 'Goals'}:{' '}
          {idea.runGoalTitles.join(', ')}
        </span>
      )}
    </div>
  )
}
