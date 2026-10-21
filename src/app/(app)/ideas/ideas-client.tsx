'use client'

import {
  Fragment,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Sparkles, ArrowRight, Check, CheckCheck, ListFilter, SquareCheck, X } from 'lucide-react'
import { IdeaCardData } from '@/components/idea-card'
import { IDEA_STATUS_LABEL, isSelectableIdea, RunIdeaCard } from '@/components/run-idea-card'
import { PageHeader } from '@/components/page-header'
import { AiDraftingStatus, type DraftingStatus } from '@/components/ai-drafting-status'
import { approveIdea, rejectIdea, editIdea, draftSelectedIdeas, approveAllIdeas } from './actions'
import { showToast } from '@/components/toast-notification'
import { ConfirmPopover } from '@/components/confirm-popover'
import { Pagination } from '@/components/pagination'
import { cn } from '@/lib/cn'
import { formatAbsoluteDateTime } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import type { IdentitySummary } from '@/lib/identity'
import type { PageInfo } from '@/lib/pagination'
import { STATUS_TABS, type StatusFilter } from './status-filter'

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
  identity
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
}) {
  const router = useRouter()
  const pathname = usePathname()
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
  const changeStatus = (next: StatusFilter) =>
    startFiltering(() => {
      setSelectedStatus(next)
      // The default ('all') is left out of the URL, and a new filter starts
      // on its first page.
      router.push(next === 'all' ? pathname : `${pathname}?status=${next}`)
    })
  const [isActionBusy, setIsActionBusy] = useState(false)
  const draftingRef = useRef(false)
  const [ideaActionBusyId, setIdeaActionBusyId] = useState<string | null>(null)
  const [draftStatus, setDraftStatus] = useState<DraftingStatus>('idle')
  const [draftError, setDraftError] = useState<string | null>(null)
  // The ideas behind the latest drafting attempt, so Try again retries exactly those.
  const [draftTargetIds, setDraftTargetIds] = useState<string[]>([])
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

  const handleApprove = async (id: string) => {
    setIdeaActionBusyId(id)
    try {
      const res = await approveIdea(id)
      if (res.success) {
        setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'approved' } : i)))
        showToast({ title: 'Approved', message: 'Idea successfully approved', type: 'success' })
      } else {
        showToast({ title: 'Approve failed', message: res.error, type: 'error' })
      }
    } finally {
      setIdeaActionBusyId(null)
    }
  }

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

  const handleReject = async (id: string) => {
    setIdeaActionBusyId(id)
    try {
      const res = await rejectIdea(id)
      if (res.success) {
        setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'rejected' } : i)))
        showToast({ title: 'Rejected', message: 'Idea rejected', type: 'info' })
      } else {
        showToast({ title: 'Reject failed', message: res.error, type: 'error' })
      }
    } finally {
      setIdeaActionBusyId(null)
    }
  }

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
  const draftIdeas = async (targetIds: string[]) => {
    if (targetIds.length === 0 || draftingRef.current) return
    draftingRef.current = true
    try {
      await runDrafting(targetIds)
    } finally {
      draftingRef.current = false
    }
  }

  // Drafts the ideas. The caller holds draftingRef.
  const runDrafting = async (targetIds: string[]) => {
    // Optimistically flip the drafted ideas to their terminal state right away so
    // the list reflects the action immediately, instead of sitting unchanged for
    // the full duration of the (multi-LLM-call) server action below.
    setIsActionBusy(true)
    setDraftStatus('processing')
    setDraftError(null)
    setDraftTargetIds(targetIds)
    setIdeas((prev) => prev.map((i) => (targetIds.includes(i.id) ? { ...i, status: 'drafted' } : i)))

    try {
      const res = await draftSelectedIdeas({ ideaIds: targetIds })
      if (res.success) {
        setDraftStatus('success')
        setTicked((prev) => prev.filter((id) => !targetIds.includes(id)))
        showToast({
          title: 'Posts generated',
          message: `${res.draftedCount} post${res.draftedCount === 1 ? '' : 's'} drafted and ready for review.${res.note ? ` ${res.note}` : ''}`,
          type: 'success'
        })
        router.push('/posts')
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

  // Posts are made only from the selected ideas that are approved.
  const handleDraftSelected = async () => {
    await draftIdeas(selectedApproved)
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
  const handleApproveSelectedAndDraft = async () => {
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
      await runDrafting([...alreadyApprovedIds, ...approvedNow])
    } finally {
      draftingRef.current = false
    }
  }

  const handleDraftSingle = async (id: string) => {
    setIdeaActionBusyId(id)
    try {
      await draftIdeas([id])
    } finally {
      setIdeaActionBusyId(null)
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Idea Review & Approval"
        description={`Review post ideas for ${identity.name}`}
        actions={
          isDrafting ? (
            <span
              aria-busy
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-[13px] font-semibold text-white opacity-75 shadow-sm"
            >
              <Sparkles className="h-3.5 w-3.5 animate-pulse" />
              Generating posts…
            </span>
          ) : showGeneratingOnly ? null : selection.length > 0 ? (
            // With ideas ticked, every action works on the selection only.
            <>
              <span className="text-foreground inline-flex h-8 items-center gap-1 text-[13px] font-medium tabular-nums">
                {/* The count is on the buttons too; phones keep one row. */}
                <span className="hidden sm:inline">{selection.length} selected</span>
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
                  className="inline-flex cursor-pointer h-8 items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3.5 text-[13px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/10 disabled:opacity-60 dark:text-emerald-400"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  <span>Approve {selectedProposed.length}</span>
                </button>
              )}

              {selectedProposed.length === 0 ? (
                <button
                  type="button"
                  onClick={handleDraftSelected}
                  disabled={isActionBusy}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{`Create ${selectedApproved.length} post${selectedApproved.length === 1 ? '' : 's'}`}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                <ConfirmPopover
                  title={`Approve and create ${selection.length} post${selection.length === 1 ? '' : 's'}?`}
                  description={`The ${selectedProposed.length} selected idea${selectedProposed.length === 1 ? ' still to review is' : 's still to review are'} approved, then a post is drafted for each selected idea. Ideas you did not select are left alone.`}
                  confirmLabel="Approve & create"
                  tone="success"
                  align="end"
                  // Don't await: the popover would otherwise stay open for the whole drafting run.
                  onConfirm={() => void handleApproveSelectedAndDraft()}
                  disabled={isActionBusy}
                >
                  <button
                    type="button"
                    disabled={isActionBusy}
                    className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Approve &amp; create {selection.length}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </ConfirmPopover>
              )}
            </>
          ) : (
            <>
              {allProposedIds.length > 0 && (
                <ConfirmPopover
                  title={`Approve all ${allProposedIds.length} ideas?`}
                  description="Every idea waiting for review moves to Approved. No posts are written until you select ideas and create them."
                  confirmLabel="Approve all"
                  tone="success"
                  onConfirm={handleApproveAll}
                  disabled={isActionBusy}
                >
                  <button
                    type="button"
                    disabled={isActionBusy}
                    className="inline-flex cursor-pointer h-8 items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3.5 text-[13px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/10 disabled:opacity-60 dark:text-emerald-400"
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
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
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
            <div className="flex items-center gap-3">
              <StatusFilterMenu
                value={selectedStatus}
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
          )
        }
      />

      {/* Scrollable ideas list */}
      <div className="relative flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-7xl space-y-4">
          <AiDraftingStatus
            status={draftStatus}
            subject={
              draftTargetIds.length > 0
                ? `${draftTargetIds.length} approved idea${draftTargetIds.length === 1 ? '' : 's'}`
                : 'your ideas'
            }
            errorMessage={draftError}
            onRetry={() => void draftIdeas(draftTargetIds)}
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
                {EMPTY_STATE[status].title}
              </h3>
              <p className="mx-auto mt-1 mb-5 max-w-sm text-xs leading-relaxed text-muted">
                {EMPTY_STATE[status].body}
              </p>
              <Link
                href="/runs"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-background transition-colors hover:bg-accent-hover"
              >
                View Runs
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
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
                query={status === 'all' ? {} : { status }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The status filter: a button that opens a short menu of statuses with their
 * counts. Picking one applies it straight away. The menu is portalled to the
 * body so the page header cannot clip it.
 */
function StatusFilterMenu({
  value,
  counts,
  onChange
}: {
  value: StatusFilter
  counts: Record<StatusFilter, number>
  onChange: (next: StatusFilter) => void
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  // Focus goes back to the button that opened the menu, not to the page body.
  const closeMenu = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  // Arrow keys, Home and End move between the options; Tab leaves the menu.
  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []
    )
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const move = (next: number) => {
      e.preventDefault()
      items[(next + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') move(index + 1)
    else if (e.key === 'ArrowUp') move(index - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(items.length - 1)
    else if (e.key === 'Tab') {
      e.preventDefault()
      closeMenu()
    }
  }

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(224, window.innerWidth - 32)
    setPosition({
      top: rect.bottom + 8,
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))
    })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
      >
        <ListFilter className="h-3.5 w-3.5 text-muted" />
        {statusLabel(value)}
        <span className="text-muted tabular-nums">({counts[value]})</span>
      </button>

      {open &&
        createPortal(
          <>
            <div aria-hidden className="fixed inset-0 z-40" onClick={closeMenu} />
            <div
              ref={menuRef}
              role="menu"
              aria-label="Filter by status"
              onKeyDown={onMenuKeyDown}
              style={{ top: position.top, left: position.left }}
              className="fixed z-50 w-[min(14rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-1 shadow-lg"
            >
              {STATUS_TABS.map((st) => (
                <button
                  key={st}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === st}
                  autoFocus={value === st}
                  onClick={() => {
                    onChange(st)
                    closeMenu()
                  }}
                  className={cn(
                    'flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left text-xs transition-colors hover:bg-surface-hover',
                    value === st ? 'font-semibold text-foreground' : 'text-muted hover:text-foreground'
                  )}
                >
                  <Check className={cn('h-3.5 w-3.5 shrink-0', value !== st && 'invisible')} />
                  <span className="flex-1">{statusLabel(st)}</span>
                  <span className="tabular-nums">{counts[st]}</span>
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
    </>
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
