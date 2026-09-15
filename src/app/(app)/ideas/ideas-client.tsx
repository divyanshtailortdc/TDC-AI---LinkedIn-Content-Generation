'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Sparkles,
  ArrowRight,
  Filter,
  CheckCircle2,
  CheckCheck
} from 'lucide-react'
import { IdeaCard, IdeaCardData } from '@/components/idea-card'
import { PageHeader } from '@/components/page-header'
import { approveIdea, rejectIdea, editIdea, draftApprovedIdeas, approveAllIdeas } from './actions'
import { showToast } from '@/components/toast-notification'

type ClientIdeaData = IdeaCardData & { accountId: string; accountName: string }

export function IdeasClient({
  initialIdeas,
  accounts
}: {
  initialIdeas: ClientIdeaData[]
  accounts: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [ideas, setIdeas] = useState<ClientIdeaData[]>(initialIdeas)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('proposed')
  const [isActionBusy, setIsActionBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Filter ideas
  const filteredIdeas = ideas.filter((idea) => {
    const matchesAccount = selectedAccountId === 'all' || idea.accountId === selectedAccountId
    const matchesStatus =
      selectedStatus === 'all'
        ? true
        : idea.status === selectedStatus
    return matchesAccount && matchesStatus
  })

  const approvedCount = ideas.filter((i) => i.status === 'approved').length
  const proposedIdeasIds = filteredIdeas.filter((i) => i.status === 'proposed').map((i) => i.id)

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
    if (proposedIdeasIds.length === 0) return
    setIsActionBusy(true)
    setMessage(null)
    try {
      const res = await approveAllIdeas(proposedIdeasIds)
      if (res.success) {
        setIdeas((prev) => 
          prev.map((i) => 
            proposedIdeasIds.includes(i.id) ? { ...i, status: 'approved' } : i
          )
        )
        setMessage(`Successfully approved ${proposedIdeasIds.length} ideas!`)
        showToast({ title: 'Approved All', message: `Successfully approved ${proposedIdeasIds.length} ideas!`, type: 'success' })
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
        hookConcept: payload.hookConcept,
      })
      if (res.success) {
        setIdeas((prev) =>
          prev.map((i) =>
            i.id === id
              ? {
                  ...i,
                  angle: payload.angle,
                  hookConcept: payload.hookConcept,
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
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <PageHeader
        title="Idea Approval Gate"
        badge="The Gate"
        description="Review and steer angles early before they move to drafting."
        actions={
          <>
            {selectedStatus === 'proposed' && proposedIdeasIds.length > 0 && (
              <button
                type="button"
                onClick={handleApproveAll}
                disabled={isActionBusy}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 text-xs font-semibold transition-colors cursor-pointer"
              >
                <CheckCheck className="w-4 h-4" />
                <span>Approve All ({proposedIdeasIds.length})</span>
              </button>
            )}
            
            {approvedCount > 0 && (
              <button
                type="button"
                onClick={handleDraftApproved}
                disabled={isActionBusy}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>Draft Approved ({approvedCount})</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </>
        }
        bottomContent={
          <>
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-surface border border-border text-xs w-full sm:w-auto overflow-x-auto">
              {(['proposed', 'approved', 'rejected', 'all'] as const).map((st) => {
                const count =
                  st === 'all'
                    ? ideas.length
                    : ideas.filter((i) => i.status === st).length

                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setSelectedStatus(st)}
                    className={`px-3 py-1.5 rounded-lg capitalize font-medium transition-colors cursor-pointer shrink-0 ${
                      selectedStatus === st
                        ? 'bg-foreground text-background shadow-xs'
                        : 'text-muted hover:text-foreground hover:bg-surface-hover'
                    }`}
                  >
                    {st} ({count})
                  </button>
                )
              })}
            </div>

            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-muted" />
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none focus:border-accent cursor-pointer"
              >
                <option value="all">All Identities</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>
            
            {message && (
              <div className="w-full mt-2 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{message}</span>
              </div>
            )}
          </>
        }
      />

      {/* Scrollable Ideas List */}
      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="max-w-4xl mx-auto">
          {filteredIdeas.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border-2 border-dashed border-border bg-surface">
              <Sparkles className="w-8 h-8 text-muted mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-foreground">No ideas in this queue</h3>
              <p className="text-xs text-muted mt-1 max-w-sm mx-auto mb-5 leading-relaxed">
                Generate now from your Dashboard or Run engine to populate new grounded angles.
              </p>
              <Link
                href="/runs"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-background text-xs font-semibold transition-colors"
              >
                View Runs
                <ArrowRight className="w-3.5 h-3.5" />
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
