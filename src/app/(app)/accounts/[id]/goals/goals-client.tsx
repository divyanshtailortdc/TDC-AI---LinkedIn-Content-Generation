'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Target,
  Plus,
  Trash2,
  CheckCircle2,
  Loader2,
  Link as LinkIcon,
  MessageSquare,
  Users,
  Compass,
  BookOpen,
  Calendar,
  Sparkles,
  Award,
  Check,
  X
} from 'lucide-react'
import { createGoal, toggleGoalActive, deleteGoal, type GoalPayload } from './actions'

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
  const [objectiveType, setObjectiveType] = useState<GoalPayload['objectiveType']>('authority')
  const [audienceId, setAudienceId] = useState(audiences[0]?.id || '')
  const [keyMessage, setKeyMessage] = useState('')
  const [selectedProofIds, setSelectedProofIds] = useState<string[]>([])
  const [desiredAction, setDesiredAction] = useState('')
  const [targetUrl, setTargetUrl] = useState('')
  const [linkStrategy, setLinkStrategy] = useState<'body' | 'first_comment'>('first_comment')
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
      setError('The Key Message to Land is required — the agent needs to know the exact belief to move.')
      return
    }

    setError(null)
    setIsSubmitting(true)

    try {
      const dos = dosText.split('\n').map(s => s.trim()).filter(Boolean)
      const donts = dontsText.split('\n').map(s => s.trim()).filter(Boolean)

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
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleToggle = async (goalId: string, current: boolean) => {
    setActionId(goalId)
    try {
      await toggleGoalActive(goalId, accountId, !current)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to update goal')
    } finally {
      setActionId(null)
    }
  }

  const handleDelete = async (goalId: string) => {
    if (!confirm('Are you sure you want to delete this campaign goal?')) return
    setActionId(goalId)
    try {
      await deleteGoal(goalId, accountId)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to delete goal')
    } finally {
      setActionId(null)
    }
  }

  const parsedGoals = initialGoals.map((g) => {
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
          linkStrategy: (data.linkStrategy as 'body' | 'first_comment') || 'first_comment',
          successMetric: (data.successMetric as string) || '',
          weight: (data.weight as number) || 5,
          startDate: (data.startDate as string) || '',
          endDate: (data.endDate as string) || '',
          dos: (data.dos as string[]) || [],
          donts: (data.donts as string[]) || [],
          targetCount: g.targetCount,
          isActive: g.isActive,
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
      isActive: g.isActive,
    }
  })

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Campaign Goals</h1>
          <p className="text-sm text-muted mt-1">
            Define the business objectives, key messages to land, proof assets, and CTAs that steer generated posts.
          </p>
        </div>
        {!showNewGoal && (
          <button
            type="button"
            onClick={() => setShowNewGoal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-background text-sm font-medium transition-colors shadow-sm shrink-0"
          >
            <Plus className="w-4 h-4" />
            New Goal
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* New Goal Form */}
      {showNewGoal && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-surface p-6 space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Compass className="w-4 h-4 text-accent" />
              Define New Campaign Goal
            </h2>
            {initialGoals.length > 0 && (
              <button
                type="button"
                onClick={() => setShowNewGoal(false)}
                className="text-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Title & Objective */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Goal Title <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Q4 AI Cost Optimization Campaign"
                required
                className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Objective Type</label>
              <select
                value={objectiveType}
                onChange={(e) => setObjectiveType(e.target.value as any)}
                className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-foreground"
              >
                <option value="awareness">Awareness (Reach &amp; Impressions)</option>
                <option value="engagement">Engagement (Meaningful discussions &amp; DMs)</option>
                <option value="authority">Authority (Thought leadership &amp; POV)</option>
                <option value="lead_gen">Lead Gen (Inbound inquiries &amp; demos)</option>
                <option value="recruiting">Recruiting (Attracting top engineering talent)</option>
                <option value="community">Community (Peer network building)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Campaign Description (Optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why this campaign matters right now..."
              className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-foreground"
            />
          </div>

          {/* Target Audience */}
          {audiences.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Target Audience</label>
              <select
                value={audienceId}
                onChange={(e) => setAudienceId(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-foreground"
              >
                {audiences.map((aud) => (
                  <option key={aud.id} value={aud.id}>
                    {aud.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* The One Key Message to Land */}
          <div className="p-4 rounded-xl border border-accent/30 bg-accent/5 space-y-1.5">
            <label className="block text-xs font-bold text-accent uppercase tracking-wider">
              The One Key Message to Land <span className="text-rose-500">*</span>
            </label>
            <p className="text-xs text-muted">
              The foundational belief or thesis this content must move. Posts aimed at a belief consistently outperform generic topic posts.
            </p>
            <textarea
              rows={2}
              value={keyMessage}
              onChange={(e) => setKeyMessage(e.target.value)}
              required
              placeholder="e.g. Building custom RAG from scratch is a massive trap; standard evals with clean prompt engineering resolve 90% of issues at 1/10th the cost."
              className="w-full rounded-md border border-border bg-surface p-3 text-sm text-foreground focus:ring-1 focus:ring-accent resize-none"
            />
          </div>

          {/* Supporting Proof Assets */}
          {proofAssets.length > 0 && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-foreground">
                Supporting Proof Assets (From Knowledge Base)
              </label>
              <p className="text-xs text-muted">Select verified documents the AI will cite for statistics and quotes.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto p-2 rounded-lg border border-border bg-surface-hover">
                {proofAssets.map((asset) => {
                  const isChecked = selectedProofIds.includes(asset.id)
                  return (
                    <label
                      key={asset.id}
                      onClick={() => toggleProofAsset(asset.id)}
                      className={`flex items-center gap-2 p-2 rounded-md cursor-pointer text-xs transition-colors ${
                        isChecked
                          ? 'bg-accent/10 text-foreground font-medium border border-accent/30'
                          : 'hover:bg-surface text-muted'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="accent-accent"
                      />
                      <BookOpen className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span className="truncate">{asset.title}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* CTA & Link Strategy */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Desired Action / Call to Action
              </label>
              <input
                type="text"
                value={desiredAction}
                onChange={(e) => setDesiredAction(e.target.value)}
                placeholder="e.g. DM me for the architecture doc"
                className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Target URL (Optional)</label>
              <input
                type="url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://company.com/checklist"
                className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Link Strategy</label>
              <select
                value={linkStrategy}
                onChange={(e) => setLinkStrategy(e.target.value as 'body' | 'first_comment')}
                className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-foreground"
              >
                <option value="first_comment">First comment (Algorithmic reach)</option>
                <option value="body">In post body (Direct conversion)</option>
              </select>
            </div>
          </div>

          {/* Metrics, Weight & Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Success Metric</label>
              <input
                type="text"
                value={successMetric}
                onChange={(e) => setSuccessMetric(e.target.value)}
                placeholder="e.g. 15 inbound DMs"
                className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Priority Weight (1–10)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-foreground font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Target Posts Count</label>
              <input
                type="number"
                min={1}
                max={50}
                value={targetCount}
                onChange={(e) => setTargetCount(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Date Range (Optional)</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface-hover px-2 py-2 text-xs text-foreground"
                />
                <span className="text-xs text-muted">–</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface-hover px-2 py-2 text-xs text-foreground"
                />
              </div>
            </div>
          </div>

          {/* Dos and Don'ts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Check className="w-3.5 h-3.5" />
                Dos (one per line)
              </label>
              <textarea
                rows={3}
                value={dosText}
                onChange={(e) => setDosText(e.target.value)}
                placeholder="Cite our 62% latency benchmark&#10;Share firsthand production debugging lessons&#10;Tag the open-source repo"
                className="w-full rounded-md border border-border bg-surface-hover p-2.5 text-xs text-foreground resize-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-foreground mb-1 flex items-center gap-1 text-rose-500">
                <X className="w-3.5 h-3.5" />
                Don&apos;ts (one per line)
              </label>
              <textarea
                rows={3}
                value={dontsText}
                onChange={(e) => setDontsText(e.target.value)}
                placeholder="Don't mention competitors by name&#10;Avoid vague hype words like 'revolutionize'&#10;Don't disclose client contract sizes"
                className="w-full rounded-md border border-border bg-surface-hover p-2.5 text-xs text-foreground resize-none"
              />
            </div>
          </div>

          <div className="pt-3 flex justify-end gap-3 border-t border-border">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-background text-sm font-medium transition-colors disabled:opacity-50 shadow-sm"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
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
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Target className="w-4 h-4 text-accent" />
            Configured Goals ({parsedGoals.length})
          </h2>
          <span className="text-xs text-muted">
            Weights balance multi-goal post generation into a defensible content calendar
          </span>
        </div>

        {parsedGoals.length === 0 ? (
          <div className="py-12 text-center rounded-xl border border-dashed border-border bg-surface">
            <p className="text-sm font-medium text-foreground">No goals defined yet</p>
            <p className="text-xs text-muted mt-1">
              Create your first campaign goal above to direct what the AI writes to achieve.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {parsedGoals.map((g) => {
              const audience = audiences.find(a => a.id === g.audienceId)

              return (
                <div
                  key={g.id}
                  className={`rounded-xl border p-5 space-y-4 transition-colors ${
                    g.isActive
                      ? 'border-border bg-surface'
                      : 'border-border bg-surface/50 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-[11px] font-semibold uppercase px-2.5 py-0.5 rounded-full bg-accent/10 text-accent">
                          {g.objectiveType}
                        </span>
                        <h3 className="text-base font-semibold text-foreground">{g.displayTitle}</h3>
                        <span className="text-xs font-mono font-medium bg-surface-hover px-2 py-0.5 rounded text-foreground">
                          Weight: {g.weight}/10
                        </span>
                        <span className="text-xs text-muted font-mono bg-surface-hover px-2 py-0.5 rounded">
                          Target: {g.targetCount} posts
                        </span>
                        {audience && (
                          <span className="text-xs text-muted bg-surface-hover px-2 py-0.5 rounded flex items-center gap-1">
                            <Users className="w-3 h-3 text-accent" />
                            {audience.name}
                          </span>
                        )}
                      </div>

                      {g.description && (
                        <p className="text-xs text-muted mt-1">{g.description}</p>
                      )}

                      {/* Key Message Box */}
                      {g.keyMessage && (
                        <div className="mt-3 p-3 rounded-lg border border-accent/20 bg-accent/5 text-xs space-y-1">
                          <span className="font-semibold text-accent uppercase tracking-wide text-[10px]">
                            Key Message To Land:
                          </span>
                          <p className="text-foreground font-medium leading-relaxed">
                            &quot;{g.keyMessage}&quot;
                          </p>
                        </div>
                      )}

                      {/* Proof Assets & Metadata */}
                      <div className="flex items-center gap-4 mt-3 text-xs text-muted flex-wrap">
                        {g.proofAssetIds.length > 0 && (
                          <span className="flex items-center gap-1 text-accent font-medium">
                            <BookOpen className="w-3.5 h-3.5" />
                            {g.proofAssetIds.length} proof assets attached
                          </span>
                        )}
                        {g.desiredAction && (
                          <span className="flex items-center gap-1">
                            <MessageSquare className="w-3.5 h-3.5 text-accent" />
                            CTA: {g.desiredAction}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <LinkIcon className="w-3.5 h-3.5" />
                          Link in: {g.linkStrategy === 'first_comment' ? 'First comment' : 'Post body'}
                        </span>
                        {g.successMetric && (
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <Award className="w-3.5 h-3.5" />
                            Target: {g.successMetric}
                          </span>
                        )}
                        {(g.startDate || g.endDate) && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {g.startDate || 'Any'} to {g.endDate || 'Ongoing'}
                          </span>
                        )}
                      </div>

                      {/* Dos & Don'ts pills */}
                      {(g.dos.length > 0 || g.donts.length > 0) && (
                        <div className="mt-3 pt-3 border-t border-border flex gap-4 text-[11px] flex-wrap">
                          {g.dos.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">Dos:</span>
                              {g.dos.map((d, i) => (
                                <span key={i} className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded">
                                  {d}
                                </span>
                              ))}
                            </div>
                          )}
                          {g.donts.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-rose-500">Don&apos;ts:</span>
                              {g.donts.map((d, i) => (
                                <span key={i} className="bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded">
                                  {d}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggle(g.id, g.isActive)}
                        disabled={actionId === g.id}
                        className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                          g.isActive
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            : 'bg-surface-hover text-muted'
                        }`}
                      >
                        {g.isActive ? 'Active' : 'Paused'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(g.id)}
                        disabled={actionId === g.id}
                        className="text-muted hover:text-rose-500 transition-colors p-1"
                        title="Delete goal"
                      >
                        <Trash2 className="w-4 h-4" />
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
