'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Sparkles, ArrowRight, Check, CheckCheck, ListFilter } from 'lucide-react'
import { IdeaCardData } from '@/components/idea-card'
import { IDEA_STATUS_LABEL, RunIdeaCard } from '@/components/run-idea-card'
import { PageHeader } from '@/components/page-header'
import { AiDraftingStatus, type DraftingStatus } from '@/components/ai-drafting-status'
import { approveIdea, rejectIdea, editIdea, draftApprovedIdeas, approveAllIdeas } from './actions'
import { showToast } from '@/components/toast-notification'
import { ConfirmPopover } from '@/components/confirm-popover'
import { cn } from '@/lib/cn'
import type { ActiveAccount } from '@/lib/active-account'

type ClientIdeaData = IdeaCardData & { accountId: string }

const STATUS_TABS = ['proposed', 'approved', 'rejected', 'all'] as const
type StatusFilter = (typeof STATUS_TABS)[number]

const statusLabel = (status: StatusFilter) =>
  status === 'all' ? 'All statuses' : IDEA_STATUS_LABEL[status]

const EMPTY_STATE: Record<StatusFilter, { title: string; body: string }> = {
  proposed: {
    title: 'Nothing waiting for review',
    body: 'Start a run to generate new grounded ideas.'
  },
  approved: {
    title: 'No approved ideas',
    body: 'Approve ideas from the Proposed tab to draft them into posts.'
  },
  rejected: { title: 'No rejected ideas', body: 'Ideas you reject show up here.' },
  all: { title: 'No ideas yet', body: 'Start a run to generate grounded ideas.' }
}

export function IdeasClient({
  initialIdeas,
  activeAccount
}: {
  initialIdeas: ClientIdeaData[]
  activeAccount: ActiveAccount
}) {
  const router = useRouter()
  const [ideas, setIdeas] = useState<ClientIdeaData[]>(initialIdeas)
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('proposed')
  const [isActionBusy, setIsActionBusy] = useState(false)
  const [ideaActionBusyId, setIdeaActionBusyId] = useState<string | null>(null)
  const [draftStatus, setDraftStatus] = useState<DraftingStatus>('idle')
  const [draftError, setDraftError] = useState<string | null>(null)
  const isDrafting = draftStatus === 'processing'

  const statusCounts = Object.fromEntries(
    STATUS_TABS.map((st) => [
      st,
      st === 'all' ? ideas.length : ideas.filter((i) => i.status === st).length
    ])
  ) as Record<StatusFilter, number>

  // All ideas here already belong to the active account (scoped server-side).
  const filteredIdeas = ideas.filter(
    (idea) => selectedStatus === 'all' || idea.status === selectedStatus
  )

  const approvedCount = ideas.filter((i) => i.status === 'approved').length
  const allProposedIds = ideas.filter((i) => i.status === 'proposed').map((i) => i.id)

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

  const draftIdeas = async (targetIds: string[]) => {
    if (targetIds.length === 0) return

    // Optimistically flip the drafted ideas to their terminal state right away so
    // the list reflects the action immediately, instead of sitting unchanged for
    // the full duration of the (multi-LLM-call) server action below.
    setIsActionBusy(true)
    setDraftStatus('processing')
    setDraftError(null)
    setIdeas((prev) => prev.map((i) => (targetIds.includes(i.id) ? { ...i, status: 'drafted' } : i)))

    try {
      const res = await draftApprovedIdeas({ ideaIds: targetIds })
      if (res.success) {
        setDraftStatus('success')
        showToast({
          title: 'Posts generated',
          message: `${res.draftedCount} post${res.draftedCount === 1 ? '' : 's'} drafted and ready for review.`,
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

  const handleDraftApproved = async () => {
    const approvedIds = ideas.filter((i) => i.status === 'approved').map((i) => i.id)
    await draftIdeas(approvedIds)
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
        title="Idea Approval Gate"
        description={`Review post ideas for ${activeAccount.name}`}
        actions={
          <>
            {allProposedIds.length > 0 && (
              <ConfirmPopover
                title={`Approve all ${allProposedIds.length} ideas?`}
                description="Every idea waiting for review moves to Approved."
                confirmLabel="Approve all"
                tone="success"
                onConfirm={handleApproveAll}
                disabled={isActionBusy}
              >
                <button
                  type="button"
                  disabled={isActionBusy}
                  className="inline-flex cursor-pointer h-8 items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3.5 text-[13px] font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/10 disabled:opacity-60 dark:text-emerald-400"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  <span>Approve all ({allProposedIds.length})</span>
                </button>
              </ConfirmPopover>
            )}

            {(approvedCount > 0 || isDrafting) && (
              <button
                type="button"
                onClick={handleDraftApproved}
                disabled={isActionBusy}
                aria-busy={isDrafting}
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-75"
              >
                <Sparkles className={cn('h-3.5 w-3.5', isDrafting && 'animate-pulse')} />
                <span>{isDrafting ? 'Generating posts…' : `Create ${approvedCount} post${approvedCount === 1 ? '' : 's'}`}</span>
                {!isDrafting && <ArrowRight className="h-3.5 w-3.5" />}
              </button>
            )}
          </>
        }
        bottomContent={
          <StatusFilterMenu
            value={selectedStatus}
            counts={statusCounts}
            onChange={setSelectedStatus}
          />
        }
      />

      {/* Scrollable ideas list */}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-7xl space-y-4">
          <AiDraftingStatus
            status={draftStatus}
            subject="your approved ideas"
            errorMessage={draftError}
            onRetry={handleDraftApproved}
            retryDisabled={isActionBusy}
          />

          {filteredIdeas.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-border bg-surface p-12 text-center">
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted" />
              <h3 className="text-sm font-semibold text-foreground">
                {EMPTY_STATE[selectedStatus].title}
              </h3>
              <p className="mx-auto mt-1 mb-5 max-w-sm text-xs leading-relaxed text-muted">
                {EMPTY_STATE[selectedStatus].body}
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
            <div className="grid grid-cols-1 items-start gap-4 pb-8 lg:grid-cols-2">
              {filteredIdeas.map((idea) => (
                <RunIdeaCard
                  key={idea.id}
                  idea={idea}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onEditSave={handleEditSave}
                  onDraft={handleDraftSingle}
                  isBusy={ideaActionBusyId === idea.id}
                  showStatus={selectedStatus === 'all'}
                />
              ))}
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
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })

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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
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
            <div aria-hidden className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              role="menu"
              aria-label="Filter by status"
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
                    setOpen(false)
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
