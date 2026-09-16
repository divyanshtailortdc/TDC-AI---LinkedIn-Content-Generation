'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Sparkles, ArrowRight, CheckCircle2, CheckCheck } from 'lucide-react'
import { IdeaCard, IdeaCardData } from '@/components/idea-card'
import { PageHeader } from '@/components/page-header'
import { approveIdea, rejectIdea, editIdea, draftApprovedIdeas, approveAllIdeas } from './actions'
import { showToast } from '@/components/toast-notification'
import { ConfirmPopover } from '@/components/confirm-popover'
import { cn } from '@/lib/cn'
import type { ActiveAccount } from '@/lib/active-account'

type ClientIdeaData = IdeaCardData & { accountId: string }

const STATUS_TABS = ['proposed', 'approved', 'rejected', 'all'] as const

export function IdeasClient({
  initialIdeas,
  activeAccount
}: {
  initialIdeas: ClientIdeaData[]
  activeAccount: ActiveAccount
}) {
  const router = useRouter()
  const [ideas, setIdeas] = useState<ClientIdeaData[]>(initialIdeas)
  const [selectedStatus, setSelectedStatus] = useState<string>('proposed')
  const [isActionBusy, setIsActionBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // All ideas here already belong to the active account (scoped server-side).
  const filteredIdeas = ideas.filter(
    (idea) => selectedStatus === 'all' || idea.status === selectedStatus
  )

  const approvedCount = ideas.filter((i) => i.status === 'approved').length
  const allProposedIds = ideas.filter((i) => i.status === 'proposed').map((i) => i.id)

  const handleApprove = async (id: string) => {
    setIsActionBusy(true)
    setMessage(null)
    try {
      const res = await approveIdea(id)
      if (res.success) {
        setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'approved' } : i)))
        showToast({ title: 'Approved', message: 'Idea successfully approved', type: 'success' })
      }
    } finally {
      setIsActionBusy(false)
    }
  }

  const handleApproveAll = async () => {
    if (allProposedIds.length === 0) return
    setIsActionBusy(true)
    setMessage(null)
    try {
      const res = await approveAllIdeas(allProposedIds)
      if (res.success) {
        setIdeas((prev) =>
          prev.map((i) => (allProposedIds.includes(i.id) ? { ...i, status: 'approved' } : i))
        )
        showToast({
          title: 'Approved All',
          message: `Successfully approved ${allProposedIds.length} ideas!`,
          type: 'success'
        })
      }
    } finally {
      setIsActionBusy(false)
    }
  }

  const handleReject = async (id: string) => {
    setIsActionBusy(true)
    setMessage(null)
    try {
      const res = await rejectIdea(id)
      if (res.success) {
        setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'rejected' } : i)))
        showToast({ title: 'Rejected', message: 'Idea rejected', type: 'info' })
      }
    } finally {
      setIsActionBusy(false)
    }
  }

  const handleEditSave = async (id: string, payload: { hookConcept: string; angle: string }) => {
    setIsActionBusy(true)
    try {
      const res = await editIdea(id, {
        angle: payload.angle,
        hookConcept: payload.hookConcept
      })
      if (res.success) {
        setIdeas((prev) =>
          prev.map((i) =>
            i.id === id
              ? {
                  ...i,
                  angle: payload.angle,
                  hookConcept: payload.hookConcept
                }
              : i
          )
        )
        showToast({ title: 'Saved', message: 'Idea edits saved successfully', type: 'success' })
      }
    } finally {
      setIsActionBusy(false)
    }
  }

  const handleDraftApproved = async () => {
    setIsActionBusy(true)
    setMessage('Drafting approved ideas with grounded citations and platform rules...')
    try {
      const approvedIds = ideas.filter((i) => i.status === 'approved').map((i) => i.id)
      const res = await draftApprovedIdeas({ ideaIds: approvedIds })
      if (res.success) {
        setMessage(`Successfully drafted ${res.draftedCount} post(s)! Redirecting to review queue...`)
        setTimeout(() => {
          router.push('/posts')
        }, 1200)
      } else {
        setMessage(res.error || 'Drafting failed')
      }
    } finally {
      setIsActionBusy(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Idea Approval Gate"
        badge="The Gate"
        description={`Reviewing angles for ${activeAccount.name} · @${activeAccount.handle}`}
        actions={
          <>
            {allProposedIds.length > 0 && (
              <ConfirmPopover
                title={`Approve all ${allProposedIds.length} proposed ideas?`}
                description="Every proposed idea for this identity moves to Approved."
                confirmLabel="Approve all"
                tone="success"
                onConfirm={handleApproveAll}
                disabled={isActionBusy}
              >
                <button
                  type="button"
                  disabled={isActionBusy}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-500/30 px-4 py-2.5 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/10 disabled:opacity-60 dark:text-emerald-400"
                >
                  <CheckCheck className="h-4 w-4" />
                  <span>Approve All ({allProposedIds.length})</span>
                </button>
              </ConfirmPopover>
            )}

            {approvedCount > 0 && (
              <ConfirmPopover
                title={`Draft ${approvedCount} approved idea${approvedCount === 1 ? '' : 's'}?`}
                description="Generates grounded post copy for every approved idea and sends you to the review queue."
                confirmLabel="Draft now"
                tone="success"
                align="end"
                onConfirm={handleDraftApproved}
                disabled={isActionBusy}
              >
                <button
                  type="button"
                  disabled={isActionBusy}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>Draft Approved ({approvedCount})</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </ConfirmPopover>
            )}
          </>
        }
      />

      {/* Status tabs live outside the scroll area so they stay put while the list scrolls */}
      <div className="flex-none border-b border-border bg-background px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="flex w-full items-center gap-1.5 overflow-x-auto rounded-xl border border-border bg-surface p-1 text-xs sm:w-auto">
            {STATUS_TABS.map((st) => {
              const count = st === 'all' ? ideas.length : ideas.filter((i) => i.status === st).length

              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setSelectedStatus(st)}
                  className={cn(
                    'shrink-0 cursor-pointer rounded-lg px-3 py-1.5 font-medium capitalize transition-colors',
                    selectedStatus === st
                      ? 'bg-foreground text-background shadow-xs'
                      : 'text-muted hover:bg-surface-hover hover:text-foreground'
                  )}
                >
                  {st} ({count})
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Scrollable ideas list */}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-3xl space-y-4">
          {message && (
            <div className="flex w-full items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{message}</span>
            </div>
          )}

          {filteredIdeas.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-border bg-surface p-12 text-center">
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted" />
              <h3 className="text-sm font-semibold text-foreground">No ideas in this queue</h3>
              <p className="mx-auto mt-1 mb-5 max-w-sm text-xs leading-relaxed text-muted">
                Generate now from your Dashboard or Run engine to populate new grounded angles for{' '}
                {activeAccount.name}.
              </p>
              <Link
                href="/runs"
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-background transition-colors"
              >
                View Runs
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <div className="space-y-4 pb-8">
              {filteredIdeas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onEditSave={handleEditSave}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
