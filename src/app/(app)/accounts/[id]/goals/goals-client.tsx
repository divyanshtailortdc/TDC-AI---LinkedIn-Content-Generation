'use client'

import { showToast } from '@/components/toast-notification'
import {
  Award,
  BookOpen,
  Calendar,
  Check,
  Compass,
  Link as LinkIcon,
  Loader2,
  MessageSquare,
  Plus,
  Target,
  Trash2,
  Users,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  createGoal,
  deleteGoal,
  toggleGoalActive,
  type GoalPayload
} from './actions'

type Audience = {
  id: string
  name: string
}

type ProofAsset = {
  id: string
  title: string
  sourceType: string
}

type RawGoal = {
  id: string
  title: string
  objective: string
  targetCount: number
  isActive: boolean
  createdAt: Date | string
}

export function GoalsClient({
  accountId,
  accountName,
  initialGoals,
  audiences,
  proofAssets
}: {
  accountId: string
  accountName: string
  initialGoals: RawGoal[]
  audiences: Audience[]
  proofAssets: ProofAsset[]
}) {
  const router = useRouter()
  const [showNewGoal, setShowNewGoal] = useState(initialGoals.length === 0)

  // Form states
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [objectiveType, setObjectiveType] =
    useState<GoalPayload['objectiveType']>('authority')
  const [audienceId, setAudienceId] = useState(audiences[0]?.id || '')
  const [keyMessage, setKeyMessage] = useState('')
  const [selectedProofIds, setSelectedProofIds] = useState<string[]>([])
  const [desiredAction, setDesiredAction] = useState('')
  const [targetUrl, setTargetUrl] = useState('')
  const [linkStrategy, setLinkStrategy] = useState<'body' | 'first_comment'>(
    'first_comment'
  )
  const [successMetric, setSuccessMetric] = useState('')
  const [weight, setWeight] = useState(7)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dosText, setDosText] = useState('')
  const [dontsText, setDontsText] = useState('')
  const [targetCount, setTargetCount] = useState(5)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggleProofAsset = (id: string) => {
    if (selectedProofIds.includes(id)) {
      setSelectedProofIds(selectedProofIds.filter(x => x !== id))
    } else {
      setSelectedProofIds([...selectedProofIds, id])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Please provide a goal title.')
      return
    }
    if (!keyMessage.trim()) {
      setError(
        'The Key Message to Land is required — the agent needs to know the exact belief to move.'
      )
      return
    }

    setError(null)
    setIsSubmitting(true)

    try {
      const dos = dosText
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
      const donts = dontsText
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)

      await createGoal(accountId, {
        title,
        description,
        objectiveType,
        audienceId: audienceId || undefined,
        keyMessage,
        proofAssetIds: selectedProofIds,
        desiredAction,
        targetUrl,
        linkStrategy,
        successMetric,
        weight,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        active: true,
        dos,
        donts,
        targetCount
      })

      showToast({
        type: 'success',
        title: 'Goal Saved',
        message: `Campaign goal "${title.trim()}" created successfully.`
      })

      setTitle('')
      setDescription('')
      setKeyMessage('')
      setSelectedProofIds([])
      setDesiredAction('')
      setTargetUrl('')
      setSuccessMetric('')
      setDosText('')
      setDontsText('')
      setShowNewGoal(false)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to create goal')
      showToast({
        type: 'error',
        title: 'Goal Creation Failed',
        message: err.message || 'Failed to create goal'
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleToggle = async (goalId: string, current: boolean) => {
    setActionId(goalId)
    try {
      await toggleGoalActive(goalId, accountId, !current)
      showToast({
        type: 'info',
        title: !current ? 'Goal Activated' : 'Goal Paused',
        message: `Campaign goal has been ${!current ? 'activated' : 'paused'}.`
      })
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to update goal')
      showToast({
        type: 'error',
        title: 'Update Failed',
        message: err.message || 'Failed to update goal'
      })
    } finally {
      setActionId(null)
    }
  }

  const handleDelete = async (goalId: string) => {
    if (!confirm('Are you sure you want to delete this campaign goal?')) return
    setActionId(goalId)
    try {
      await deleteGoal(goalId, accountId)
      showToast({
        type: 'info',
        title: 'Goal Deleted',
        message: 'Campaign goal has been removed.'
      })
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to delete goal')
      showToast({
        type: 'error',
        title: 'Delete Failed',
        message: err.message || 'Failed to delete goal'
      })
    } finally {
      setActionId(null)
    }
  }

  const parsedGoals = initialGoals.map(g => {
    try {
      const data = JSON.parse(g.title)
      if (data && typeof data === 'object' && data.title) {
        return {
          id: g.id,
          displayTitle: data.title as string,
          description: (data.description as string) || '',
          objectiveType: (data.objectiveType as string) || g.objective,
          audienceId: (data.audienceId as string) || '',
          keyMessage: (data.keyMessage as string) || '',
          proofAssetIds: (data.proofAssetIds as string[]) || [],
          desiredAction: (data.desiredAction as string) || '',
          targetUrl: (data.targetUrl as string) || '',
          linkStrategy:
            (data.linkStrategy as 'body' | 'first_comment') || 'first_comment',
          successMetric: (data.successMetric as string) || '',
          weight: (data.weight as number) || 5,
          startDate: (data.startDate as string) || '',
          endDate: (data.endDate as string) || '',
          dos: (data.dos as string[]) || [],
          donts: (data.donts as string[]) || [],
          targetCount: g.targetCount,
          isActive: g.isActive
        }
      }
    } catch {}
    return {
      id: g.id,
      displayTitle: g.title,
      description: '',
      objectiveType: g.objective,
      audienceId: '',
      keyMessage: '',
      proofAssetIds: [],
      desiredAction: '',
      targetUrl: '',
      linkStrategy: 'first_comment' as const,
      successMetric: '',
      weight: 5,
      startDate: '',
      endDate: '',
      dos: [],
      donts: [],
      targetCount: g.targetCount,
      isActive: g.isActive
    }
  })

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Campaign Goals</h1>
          <p className="text-muted mt-1 text-sm">
            Define the business objectives, key messages to land, proof assets,
            and CTAs that steer generated posts.
          </p>
        </div>
        {!showNewGoal && (
          <button
            type="button"
            onClick={() => setShowNewGoal(true)}
            className="bg-accent hover:bg-accent-hover text-background flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Goal
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* New Goal Form */}
      {showNewGoal && (
        <form
          onSubmit={handleSubmit}
          className="border-border bg-surface space-y-6 rounded-xl border p-6"
        >
          <div className="border-border flex items-center justify-between border-b pb-3">
            <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
              <Compass className="text-accent h-4 w-4" />
              Define New Campaign Goal
            </h2>
            {initialGoals.length > 0 && (
              <button
                type="button"
                onClick={() => setShowNewGoal(false)}
                className="text-muted hover:text-foreground text-xs"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Title & Objective */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                Goal Title <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Q4 AI Cost Optimization Campaign"
                required
                className="border-border bg-surface-hover text-foreground focus:ring-accent w-full rounded-md border px-3 py-2 text-sm focus:ring-1"
              />
            </div>

            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                Objective Type
              </label>
              <select
                value={objectiveType}
                onChange={e => setObjectiveType(e.target.value as any)}
                className="border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="awareness">
                  Awareness (Reach &amp; Impressions)
                </option>
                <option value="engagement">
                  Engagement (Meaningful discussions &amp; DMs)
                </option>
                <option value="authority">
                  Authority (Thought leadership &amp; POV)
                </option>
                <option value="lead_gen">
                  Lead Gen (Inbound inquiries &amp; demos)
                </option>
                <option value="recruiting">
                  Recruiting (Attracting top engineering talent)
                </option>
                <option value="community">
                  Community (Peer network building)
                </option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-foreground mb-1 block text-xs font-medium">
              Campaign Description (Optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Why this campaign matters right now..."
              className="border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          {/* Target Audience */}
          {audiences.length > 0 && (
            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                Target Audience
              </label>
              <select
                value={audienceId}
                onChange={e => setAudienceId(e.target.value)}
                className="border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm"
              >
                {audiences.map(aud => (
                  <option key={aud.id} value={aud.id}>
                    {aud.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* The One Key Message to Land */}
          <div className="border-accent/30 bg-accent/5 space-y-1.5 rounded-xl border p-4">
            <label className="text-accent block text-xs font-bold tracking-wider uppercase">
              The One Key Message to Land{' '}
              <span className="text-rose-500">*</span>
            </label>
            <p className="text-muted text-xs">
              The foundational belief or thesis this content must move. Posts
              aimed at a belief consistently outperform generic topic posts.
            </p>
            <textarea
              rows={2}
              value={keyMessage}
              onChange={e => setKeyMessage(e.target.value)}
              required
              placeholder="e.g. Building custom RAG from scratch is a massive trap; standard evals with clean prompt engineering resolve 90% of issues at 1/10th the cost."
              className="border-border bg-surface text-foreground focus:ring-accent w-full resize-none rounded-md border p-3 text-sm focus:ring-1"
            />
          </div>

          {/* Supporting Proof Assets */}
          {proofAssets.length > 0 && (
            <div className="space-y-2">
              <label className="text-foreground block text-xs font-medium">
                Supporting Proof Assets (From Knowledge Base)
              </label>
              <p className="text-muted text-xs">
                Select verified documents the AI will cite for statistics and
                quotes.
              </p>
              <div className="border-border bg-surface-hover grid max-h-44 grid-cols-1 gap-2 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
                {proofAssets.map(asset => {
                  const isChecked = selectedProofIds.includes(asset.id)
                  return (
                    <label
                      key={asset.id}
                      onClick={() => toggleProofAsset(asset.id)}
                      className={`flex cursor-pointer items-center gap-2 rounded-md p-2 text-xs transition-colors ${
                        isChecked
                          ? 'bg-accent/10 text-foreground border-accent/30 border font-medium'
                          : 'hover:bg-surface text-muted'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="accent-accent"
                      />
                      <BookOpen className="text-accent h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{asset.title}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* CTA & Link Strategy */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                Desired Action / Call to Action
              </label>
              <input
                type="text"
                value={desiredAction}
                onChange={e => setDesiredAction(e.target.value)}
                placeholder="e.g. DM me for the architecture doc"
                className="border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                Target URL (Optional)
              </label>
              <input
                type="url"
                value={targetUrl}
                onChange={e => setTargetUrl(e.target.value)}
                placeholder="https://company.com/checklist"
                className="border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                Link Strategy
              </label>
              <select
                value={linkStrategy}
                onChange={e =>
                  setLinkStrategy(e.target.value as 'body' | 'first_comment')
                }
                className="border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="first_comment">
                  First comment (Algorithmic reach)
                </option>
                <option value="body">In post body (Direct conversion)</option>
              </select>
            </div>
          </div>

          {/* Metrics, Weight & Dates */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                Success Metric
              </label>
              <input
                type="text"
                value={successMetric}
                onChange={e => setSuccessMetric(e.target.value)}
                placeholder="e.g. 15 inbound DMs"
                className="border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                Priority Weight (1–10)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={weight}
                onChange={e => setWeight(Number(e.target.value))}
                className="border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 font-mono text-sm"
              />
            </div>

            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                Target Posts Count
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={targetCount}
                onChange={e => setTargetCount(Number(e.target.value))}
                className="border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                Date Range (Optional)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="border-border bg-surface-hover text-foreground w-full rounded-md border px-2 py-2 text-xs"
                />
                <span className="text-muted text-xs">–</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="border-border bg-surface-hover text-foreground w-full rounded-md border px-2 py-2 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Dos and Don'ts */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                Dos (one per line)
              </label>
              <textarea
                rows={3}
                value={dosText}
                onChange={e => setDosText(e.target.value)}
                placeholder="Cite our 62% latency benchmark&#10;Share firsthand production debugging lessons&#10;Tag the open-source repo"
                className="border-border bg-surface-hover text-foreground w-full resize-none rounded-md border p-2.5 text-xs"
              />
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-rose-500">
                <X className="h-3.5 w-3.5" />
                Don&apos;ts (one per line)
              </label>
              <textarea
                rows={3}
                value={dontsText}
                onChange={e => setDontsText(e.target.value)}
                placeholder="Don't mention competitors by name&#10;Avoid vague hype words like 'revolutionize'&#10;Don't disclose client contract sizes"
                className="border-border bg-surface-hover text-foreground w-full resize-none rounded-md border p-2.5 text-xs"
              />
            </div>
          </div>

          <div className="border-border flex justify-end gap-3 border-t pt-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-accent hover:bg-accent-hover text-background flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium shadow-sm transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving goal…
                </>
              ) : (
                'Save Campaign Goal →'
              )}
            </button>
          </div>
        </form>
      )}

      {/* Goals List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
            <Target className="text-accent h-4 w-4" />
            Configured Goals ({parsedGoals.length})
          </h2>
          <span className="text-muted text-xs">
            Weights balance multi-goal post generation into a defensible content
            calendar
          </span>
        </div>

        {parsedGoals.length === 0 ? (
          <div className="border-border bg-surface rounded-xl border border-dashed py-12 text-center">
            <p className="text-foreground text-sm font-medium">
              No goals defined yet
            </p>
            <p className="text-muted mt-1 text-xs">
              Create your first campaign goal above to direct what the AI writes
              to achieve.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {parsedGoals.map(g => {
              const audience = audiences.find(a => a.id === g.audienceId)

              return (
                <div
                  key={g.id}
                  className={`space-y-4 rounded-xl border p-5 transition-colors ${
                    g.isActive
                      ? 'border-border bg-surface'
                      : 'border-border bg-surface/50 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="bg-accent/10 text-accent rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase">
                          {g.objectiveType}
                        </span>
                        <h3 className="text-foreground text-base font-semibold">
                          {g.displayTitle}
                        </h3>
                        <span className="bg-surface-hover text-foreground rounded px-2 py-0.5 font-mono text-xs font-medium">
                          Weight: {g.weight}/10
                        </span>
                        <span className="text-muted bg-surface-hover rounded px-2 py-0.5 font-mono text-xs">
                          Target: {g.targetCount} posts
                        </span>
                        {audience && (
                          <span className="text-muted bg-surface-hover flex items-center gap-1 rounded px-2 py-0.5 text-xs">
                            <Users className="text-accent h-3 w-3" />
                            {audience.name}
                          </span>
                        )}
                      </div>

                      {g.description && (
                        <p className="text-muted mt-1 text-xs">
                          {g.description}
                        </p>
                      )}

                      {/* Key Message Box */}
                      {g.keyMessage && (
                        <div className="border-accent/20 bg-accent/5 mt-3 space-y-1 rounded-lg border p-3 text-xs">
                          <span className="text-accent text-[10px] font-semibold tracking-wide uppercase">
                            Key Message To Land:
                          </span>
                          <p className="text-foreground leading-relaxed font-medium">
                            &quot;{g.keyMessage}&quot;
                          </p>
                        </div>
                      )}

                      {/* Proof Assets & Metadata */}
                      <div className="text-muted mt-3 flex flex-wrap items-center gap-4 text-xs">
                        {g.proofAssetIds.length > 0 && (
                          <span className="text-accent flex items-center gap-1 font-medium">
                            <BookOpen className="h-3.5 w-3.5" />
                            {g.proofAssetIds.length} proof assets attached
                          </span>
                        )}
                        {g.desiredAction && (
                          <span className="flex items-center gap-1">
                            <MessageSquare className="text-accent h-3.5 w-3.5" />
                            CTA: {g.desiredAction}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <LinkIcon className="h-3.5 w-3.5" />
                          Link in:{' '}
                          {g.linkStrategy === 'first_comment'
                            ? 'First comment'
                            : 'Post body'}
                        </span>
                        {g.successMetric && (
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <Award className="h-3.5 w-3.5" />
                            Target: {g.successMetric}
                          </span>
                        )}
                        {(g.startDate || g.endDate) && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {g.startDate || 'Any'} to {g.endDate || 'Ongoing'}
                          </span>
                        )}
                      </div>

                      {/* Dos & Don'ts pills */}
                      {(g.dos.length > 0 || g.donts.length > 0) && (
                        <div className="border-border mt-3 flex flex-wrap gap-4 border-t pt-3 text-[11px]">
                          {g.dos.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                Dos:
                              </span>
                              {g.dos.map((d, i) => (
                                <span
                                  key={i}
                                  className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                >
                                  {d}
                                </span>
                              ))}
                            </div>
                          )}
                          {g.donts.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-rose-500">
                                Don&apos;ts:
                              </span>
                              {g.donts.map((d, i) => (
                                <span
                                  key={i}
                                  className="rounded bg-rose-50 px-2 py-0.5 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                                >
                                  {d}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleToggle(g.id, g.isActive)}
                        disabled={actionId === g.id}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          g.isActive
                            ? 'border border-emerald-500/20 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                            : 'bg-surface-hover text-muted'
                        }`}
                      >
                        {g.isActive ? 'Active' : 'Paused'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(g.id)}
                        disabled={actionId === g.id}
                        className="text-muted p-1 transition-colors hover:text-rose-500"
                        title="Delete goal"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
