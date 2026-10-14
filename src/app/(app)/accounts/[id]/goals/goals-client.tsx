'use client'

import { PrefillBanner } from '@/components/ai-setup/prefill-banner'
import { useSectionPrefill } from '@/components/ai-setup/use-section-prefill'
import { showToast } from '@/components/toast-notification'
import {
  goalSuggestionValues,
  type GoalValues
} from '@/lib/ai/identity-setup/merge'
import {
  Compass,
  Edit2,
  Link as LinkIcon,
  Loader2,
  MessageSquare,
  Plus,
  Target,
  Trash2
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  createGoal,
  deleteGoal,
  toggleGoalActive,
  updateGoal,
  type GoalPayload
} from './actions'

type RawGoal = {
  id: string
  title: string
  objective: string
  keyMessage: string | null
  desiredAction: string | null
  targetUrl: string | null
  linkStrategy: string
  isActive: boolean
  createdAt: Date | string
}

const OBJECTIVES: Array<{
  value: GoalPayload['objectiveType']
  label: string
}> = [
  { value: 'authority', label: 'Authority (Thought leadership & POV)' },
  { value: 'awareness', label: 'Awareness (Reach & impressions)' },
  { value: 'engagement', label: 'Engagement (Discussions & DMs)' },
  { value: 'lead_gen', label: 'Lead gen (Inbound inquiries & demos)' },
  { value: 'recruiting', label: 'Recruiting (Attracting talent)' },
  { value: 'community', label: 'Community (Peer network building)' }
]

export function GoalsClient({
  accountId,
  initialGoals
}: {
  accountId: string
  initialGoals: RawGoal[]
}) {
  const router = useRouter()
  const [showNewGoal, setShowNewGoal] = useState(initialGoals.length === 0)

  // Form states
  const [title, setTitle] = useState('')
  const [objectiveType, setObjectiveType] =
    useState<GoalPayload['objectiveType']>('authority')
  const [keyMessage, setKeyMessage] = useState('')
  const [desiredAction, setDesiredAction] = useState('')
  const [targetUrl, setTargetUrl] = useState('')
  const [linkStrategy, setLinkStrategy] =
    useState<GoalPayload['linkStrategy']>('first_comment')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null)
  // The goal being edited is already on screen in the form; listing it again
  // below would show it twice. Update and Cancel clear this, restoring the list.
  const isEditing = editingGoalId !== null

  // An AI setup goal opens the New Goal form prefilled; saving creates a new
  // goal, so existing goals are never touched.
  const prefill = useSectionPrefill<GoalValues>({
    draftKey: accountId,
    getCurrent: () => ({
      title,
      objectiveType,
      keyMessage,
      desiredAction,
      targetUrl
    }),
    setValues: next => {
      setEditingGoalId(null)
      setShowNewGoal(true)
      if (next.title !== undefined) setTitle(next.title)
      if (next.objectiveType !== undefined) setObjectiveType(next.objectiveType)
      if (next.keyMessage !== undefined) setKeyMessage(next.keyMessage)
      if (next.desiredAction !== undefined) setDesiredAction(next.desiredAction)
      if (next.targetUrl !== undefined) setTargetUrl(next.targetUrl)
    },
    suggestionValues: s => goalSuggestionValues(s.goals),
    // An untouched form's preset objective is just a default.
    isBlank: key => key === 'objectiveType' && !title.trim()
  })

  const resetForm = () => {
    setTitle('')
    setObjectiveType('authority')
    setKeyMessage('')
    setDesiredAction('')
    setTargetUrl('')
    setLinkStrategy('first_comment')
    setEditingGoalId(null)
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

    const payload: GoalPayload = {
      title,
      objectiveType,
      keyMessage,
      desiredAction,
      targetUrl,
      linkStrategy
    }

    try {
      if (editingGoalId) {
        await updateGoal(editingGoalId, accountId, payload)
        showToast({
          type: 'success',
          title: 'Goal Updated',
          message: `Goal "${title.trim()}" updated successfully.`
        })
      } else {
        await createGoal(accountId, payload)
        showToast({
          type: 'success',
          title: 'Goal Saved',
          message: `Goal "${title.trim()}" created successfully.`
        })
      }

      resetForm()
      setShowNewGoal(false)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to save goal')
      showToast({
        type: 'error',
        title: 'Goal Save Failed',
        message: err.message || 'Failed to save goal'
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
        message: `Goal has been ${!current ? 'activated' : 'paused'}.`
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
    if (!confirm('Are you sure you want to delete this goal?')) return
    setActionId(goalId)
    try {
      await deleteGoal(goalId, accountId)
      showToast({
        type: 'info',
        title: 'Goal Deleted',
        message: 'Goal has been removed.'
      })
      if (editingGoalId === goalId) {
        resetForm()
        setShowNewGoal(false)
      }
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

  const parsedGoals = initialGoals.map(g => ({
    id: g.id,
    displayTitle: g.title,
    objectiveType: g.objective,
    keyMessage: g.keyMessage || '',
    desiredAction: g.desiredAction || '',
    targetUrl: g.targetUrl || '',
    linkStrategy: (g.linkStrategy === 'body'
      ? 'body'
      : 'first_comment') as GoalPayload['linkStrategy'],
    isActive: g.isActive
  }))

  const handleEdit = (goal: (typeof parsedGoals)[number]) => {
    setTitle(goal.displayTitle)
    setObjectiveType(
      OBJECTIVES.some(o => o.value === goal.objectiveType)
        ? (goal.objectiveType as GoalPayload['objectiveType'])
        : 'authority'
    )
    setKeyMessage(goal.keyMessage)
    setDesiredAction(goal.desiredAction)
    setTargetUrl(goal.targetUrl)
    setLinkStrategy(goal.linkStrategy)
    setEditingGoalId(goal.id)
    setShowNewGoal(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Goals</h1>
          <p className="text-muted mt-1 text-sm">
            What your posts should achieve and the one message they need to
            land.
          </p>
        </div>
        {!showNewGoal && (
          <button
            type="button"
            onClick={() => {
              resetForm()
              setShowNewGoal(true)
            }}
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

      <PrefillBanner
        section="goals"
        prefill={prefill}
        note="Saving creates a new goal. Your existing goals are not changed."
      />

      {/* New Goal Form */}
      {showNewGoal && (
        <form
          onSubmit={handleSubmit}
          className="border-border bg-surface space-y-6 rounded-xl border p-6"
        >
          <div className="border-border flex items-center justify-between border-b pb-3">
            <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
              <Compass className="text-accent h-4 w-4" />
              {editingGoalId ? 'Edit Goal' : 'New Goal'}
            </h2>
            {initialGoals.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  resetForm()
                  setShowNewGoal(false)
                }}
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
                placeholder="e.g. Become known for our core expertise"
                required
                className="border-border bg-surface-hover text-foreground focus:ring-accent w-full rounded-md border px-3 py-2 text-sm focus:ring-1"
              />
            </div>

            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                Objective
              </label>
              <select
                value={objectiveType}
                onChange={e =>
                  setObjectiveType(
                    e.target.value as GoalPayload['objectiveType']
                  )
                }
                className="border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm"
              >
                {OBJECTIVES.map(o => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* The One Key Message to Land */}
          <div className="border-accent/30 bg-accent/5 space-y-1.5 rounded-xl border p-4">
            <label className="text-accent block text-xs font-bold tracking-wider uppercase">
              The One Key Message to Land{' '}
              <span className="text-rose-500">*</span>
            </label>
            <p className="text-muted text-xs">
              The belief your readers should hold after reading. Every post
              under this goal works toward it.
            </p>
            <textarea
              rows={2}
              value={keyMessage}
              onChange={e => setKeyMessage(e.target.value)}
              required
              placeholder="e.g. Most teams fix this problem with more tools; the real fix is a simpler process."
              className="border-border bg-surface text-foreground focus:ring-accent w-full resize-none rounded-md border p-3 text-sm focus:ring-1"
            />
          </div>

          {/* CTA & Link */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                Call to Action (Optional)
              </label>
              <input
                type="text"
                value={desiredAction}
                onChange={e => setDesiredAction(e.target.value)}
                placeholder="e.g. Comment with your experience"
                className="border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                Link to Share (Optional)
              </label>
              <input
                type="url"
                value={targetUrl}
                onChange={e => setTargetUrl(e.target.value)}
                placeholder="https://example.com/page"
                className="border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm"
              />
              {/* The placement only matters once there is a link to place. */}
              {targetUrl.trim() && (
                <div className="mt-3">
                  <label className="text-foreground mb-1 block text-xs font-medium">
                    Links Go In
                  </label>
                  <select
                    value={linkStrategy}
                    onChange={e =>
                      setLinkStrategy(
                        e.target.value as GoalPayload['linkStrategy']
                      )
                    }
                    className="border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm"
                  >
                    <option value="first_comment">
                      First comment (better reach)
                    </option>
                    <option value="body">Post body</option>
                  </select>
                </div>
              )}
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
              ) : editingGoalId ? (
                'Update Goal →'
              ) : (
                'Save Goal →'
              )}
            </button>
          </div>
        </form>
      )}

      {/* Goals List — hidden while editing */}
      {!isEditing && (
        <div className="space-y-4">
          <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
            <Target className="text-accent h-4 w-4" />
            Your Goals ({parsedGoals.length})
          </h2>

          {parsedGoals.length === 0 ? (
            <div className="border-border bg-surface rounded-xl border border-dashed py-12 text-center">
              <p className="text-foreground text-sm font-medium">
                No goals defined yet
              </p>
              <p className="text-muted mt-1 text-xs">
                Create your first goal above to direct what the AI writes to
                achieve.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {parsedGoals.map(g => {
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
                            {g.objectiveType.replace(/_/g, ' ')}
                          </span>
                          <h3 className="text-foreground text-base font-semibold">
                            {g.displayTitle}
                          </h3>
                        </div>

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

                        {(g.desiredAction || g.targetUrl) && (
                          <div className="text-muted mt-3 flex flex-wrap items-center gap-4 text-xs">
                            {g.desiredAction && (
                              <span className="flex items-center gap-1">
                                <MessageSquare className="text-accent h-3.5 w-3.5" />
                                CTA: {g.desiredAction}
                              </span>
                            )}
                            {g.targetUrl && (
                              <span className="flex min-w-0 items-center gap-1">
                                <LinkIcon className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{g.targetUrl}</span>
                                <span className="shrink-0">
                                  ·{' '}
                                  {g.linkStrategy === 'body'
                                    ? 'in post body'
                                    : 'in first comment'}
                                </span>
                              </span>
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
                          onClick={() => handleEdit(g)}
                          disabled={actionId === g.id}
                          className="text-muted hover:text-accent p-1 transition-colors"
                          title="Edit goal"
                        >
                          <Edit2 className="h-4 w-4" />
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
      )}
    </div>
  )
}
