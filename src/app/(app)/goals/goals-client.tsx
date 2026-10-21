'use client'

import {
  updateDraftSuggestions,
  useIdentitySetupDraft
} from '@/components/ai-setup/draft-store'
import { PrefillBanner } from '@/components/ai-setup/prefill-banner'
import { useSectionPrefill } from '@/components/ai-setup/use-section-prefill'
import { ConfirmPopover } from '@/components/confirm-popover'
import {
  GenerateRunDialog,
  type RunPickerData
} from '@/components/generate-run-dialog'
import { PageHeader } from '@/components/page-header'
import { showToast } from '@/components/toast-notification'
import type { GoalSuggestion } from '@/lib/ai/skills/goal-suggestions/schema'
import { EMPTY_SUGGESTIONS } from '@/lib/ai/skills/profile-setup/schema'
import { hasGoalTitle } from '@/lib/goal-titles'
import { goalSuggestionValues, type GoalValues } from '@/lib/settings-merge'
import {
  Compass,
  Edit2,
  Link as LinkIcon,
  Loader2,
  MessageSquare,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Wand2,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  createGoal,
  deleteGoal,
  suggestGoalsAction,
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
  initialGoals,
  usage,
  picker
}: {
  accountId: string
  initialGoals: RawGoal[]
  /** Ideas and posts made for each goal so far, by goal id. */
  usage: Record<string, { ideas: number; posts: number }>
  picker: RunPickerData
}) {
  const router = useRouter()
  const [showNewGoal, setShowNewGoal] = useState(initialGoals.length === 0)
  // The goals the run picker opens with ticked; null while it is closed.
  const [generateFor, setGenerateFor] = useState<string[] | null>(null)
  // The page scrolls inside this box, not the window. The form sits at its top.
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollToForm = () =>
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })

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
  const [suggestions, setSuggestions] = useState<GoalSuggestion[] | null>(null)
  const [isSuggesting, setIsSuggesting] = useState(false)

  const savedTitles = initialGoals.map(g => g.title)
  // Takes the AI goal off the draft, so it is not offered again.
  const dropSuggestedGoal = () =>
    updateDraftSuggestions(accountId, s => ({
      ...s,
      goals: EMPTY_SUGGESTIONS.goals
    }))

  // An AI setup goal opens the New Goal form prefilled; saving creates a new
  // goal, so existing goals are never touched.
  const prefill = useSectionPrefill<GoalValues>({
    draftKey: accountId,
    section: 'goals',
    getCurrent: () => ({
      title,
      objectiveType,
      keyMessage,
      desiredAction,
      targetUrl,
      linkStrategy
    }),
    setValues: next => {
      setEditingGoalId(null)
      setShowNewGoal(true)
      if (next.title !== undefined) setTitle(next.title)
      if (next.objectiveType !== undefined) setObjectiveType(next.objectiveType)
      if (next.keyMessage !== undefined) setKeyMessage(next.keyMessage)
      if (next.desiredAction !== undefined) setDesiredAction(next.desiredAction)
      if (next.targetUrl !== undefined) setTargetUrl(next.targetUrl)
      if (next.linkStrategy !== undefined) setLinkStrategy(next.linkStrategy)
    },
    // A suggested goal that is already saved is not offered again.
    suggestionValues: s => {
      const values = goalSuggestionValues(s.goals)
      return hasGoalTitle(savedTitles, values.title ?? '') ? {} : values
    },
    // An untouched form's preset choices are just defaults.
    isBlank: key =>
      (key === 'objectiveType' || key === 'linkStrategy') && !title.trim()
  })

  // The AI goal is already saved (here, or on another visit): take it off the
  // draft so it is not offered, and cannot be saved a second time.
  const suggestedGoalTitle =
    useIdentitySetupDraft(accountId)?.suggestions.goals.title?.value
  const suggestedGoalIsSaved = hasGoalTitle(
    savedTitles,
    typeof suggestedGoalTitle === 'string' ? suggestedGoalTitle : ''
  )
  useEffect(() => {
    if (suggestedGoalIsSaved) dropSuggestedGoal()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dropSuggestedGoal only reads accountId
  }, [accountId, suggestedGoalIsSaved])

  const resetForm = () => {
    setTitle('')
    setObjectiveType('authority')
    setKeyMessage('')
    setDesiredAction('')
    setTargetUrl('')
    setLinkStrategy('first_comment')
    setEditingGoalId(null)
  }

  const handleSuggest = async () => {
    setIsSuggesting(true)
    setError(null)
    try {
      const result = await suggestGoalsAction(accountId)
      if (result.success) {
        setSuggestions(result.suggestions)
      } else {
        showToast({
          type: 'error',
          title: 'No Suggestions',
          message: result.error
        })
      }
    } finally {
      setIsSuggesting(false)
    }
  }

  // Fills the New Goal form; nothing is saved until the user clicks Save Goal.
  const handleUseSuggestion = (suggestion: GoalSuggestion) => {
    resetForm()
    setTitle(suggestion.title)
    setObjectiveType(suggestion.objectiveType)
    setKeyMessage(suggestion.keyMessage)
    setDesiredAction(suggestion.desiredAction || '')
    setTargetUrl(suggestion.targetUrl || '')
    setError(null)
    setSuggestions(null)
    setShowNewGoal(true)
    scrollToForm()
  }

  const submitGoal = async (): Promise<boolean> => {
    if (!title.trim()) {
      setError('Please provide a goal title.')
      return false
    }
    if (!keyMessage.trim()) {
      setError(
        'The Key Message to Land is required — the agent needs to know the exact belief to move.'
      )
      return false
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

      // A goal made from the AI suggestion leaves the draft, so the next
      // visit does not offer it again.
      if (!editingGoalId && prefill.active && prefill.filled.length > 0) {
        dropSuggestedGoal()
      }
      prefill.markSaved()
      resetForm()
      setShowNewGoal(false)
      router.refresh()
      return true
    } catch (err: any) {
      setError(err.message || 'Failed to save goal')
      showToast({
        type: 'error',
        title: 'Goal Save Failed',
        message: err.message || 'Failed to save goal'
      })
      return false
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void submitGoal()
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

  // Confirmed by the ConfirmPopover around the delete button.
  const handleDelete = async (goalId: string) => {
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
    scrollToForm()
  }

  const activeCount = parsedGoals.filter(g => g.isActive).length

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Goals"
        description="What your posts should achieve. Pick goals for each run; ideas are written only for the goals you pick."
        actions={
          <>
            {!isEditing && (
              <button
                type="button"
                onClick={handleSuggest}
                disabled={isSuggesting}
                aria-label={isSuggesting ? 'Suggesting goals' : 'Suggest Goals'}
                // Icon only on phones, so the header's buttons stay on one row.
                className="border-border bg-surface text-foreground hover:bg-surface-hover flex h-8 w-8 items-center justify-center gap-1.5 rounded-lg border text-[13px] font-medium transition-colors disabled:opacity-50 sm:w-auto sm:px-3.5"
              >
                {isSuggesting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="text-accent h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">
                  {isSuggesting ? 'Suggesting…' : 'Suggest Goals'}
                </span>
              </button>
            )}
            {!showNewGoal && (
              <button
                type="button"
                onClick={() => {
                  resetForm()
                  setShowNewGoal(true)
                }}
                className="border-border bg-surface text-foreground hover:bg-surface-hover flex h-8 items-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-medium transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                New<span className="hidden sm:inline"> Goal</span>
              </button>
            )}
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setGenerateFor(
                    parsedGoals.filter(g => g.isActive).map(g => g.id)
                  )
                }
                className="bg-accent hover:bg-accent-hover text-background flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium shadow-sm transition-colors"
              >
                <Wand2 className="h-3.5 w-3.5" />
                Generate ideas
              </button>
            )}
          </>
        }
      />

      <GenerateRunDialog
        open={generateFor !== null}
        onClose={() => setGenerateFor(null)}
        picker={picker}
        initialSelected={generateFor ?? undefined}
      />

      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto p-4 sm:p-6"
      >
        <div className="mx-auto max-w-4xl space-y-8">
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

          {/* Suggested goals — picking one only fills the form */}
          {suggestions && !isEditing && (
            <div className="border-border bg-surface space-y-4 rounded-xl border p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
                    <Sparkles className="text-accent h-4 w-4" />
                    Suggested Goals
                  </h2>
                  <p className="text-muted mt-1 text-xs">
                    Based on your saved profile. Pick one to fill the form, then
                    review it and save.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSuggestions(null)}
                  aria-label="Dismiss suggestions"
                  className="text-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {suggestions.map(s => (
                  <div
                    key={s.title}
                    className="border-border bg-surface-hover/40 flex flex-col gap-3 rounded-lg border p-4"
                  >
                    <span className="bg-accent/10 text-accent self-start rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                      {OBJECTIVES.find(
                        o => o.value === s.objectiveType
                      )?.label.split(' (')[0] ?? s.objectiveType}
                    </span>
                    <p className="text-foreground text-sm font-semibold">
                      {s.title}
                    </p>
                    <p className="text-muted text-xs leading-relaxed">
                      {s.keyMessage}
                    </p>
                    {s.desiredAction && (
                      <p className="text-muted text-xs">
                        <span className="text-foreground font-medium">
                          CTA:
                        </span>{' '}
                        {s.desiredAction}
                      </p>
                    )}
                    {s.basedOn && (
                      <p className="text-muted text-[11px]">
                        Based on: {s.basedOn}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => handleUseSuggestion(s)}
                      className="border-border text-foreground hover:bg-surface-hover mt-auto h-7 rounded-lg border px-2.5 text-xs font-medium"
                    >
                      Use This Goal
                    </button>
                  </div>
                ))}
              </div>
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
                    Goal Title{' '}
                    <span className="text-rose-600 dark:text-rose-400">*</span>
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
                  Key Message{' '}
                  <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>

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

              <div className="border-border flex justify-end gap-2 border-t pt-3">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-accent hover:bg-accent-hover text-background flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
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
                    Create your first goal above. Every run writes toward the
                    goals you pick for it.
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
                            : 'border-border bg-surface/50'
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
                                  Key Message:
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
                                    <span className="truncate">
                                      {g.targetUrl}
                                    </span>
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
                              aria-pressed={g.isActive}
                              title={
                                g.isActive
                                  ? 'Active: offered when you start a run, and used by scheduled runs. Click to pause.'
                                  : 'Paused: not offered for runs or used by the schedule. Click to resume.'
                              }
                              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                g.isActive
                                  ? 'border border-emerald-500/20 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
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
                              aria-label={`Edit ${g.displayTitle}`}
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>

                            <ConfirmPopover
                              title="Delete this goal?"
                              description={
                                (usage[g.id]?.ideas ?? 0) > 0
                                  ? 'The goal will be permanently removed. Ideas already made for it keep its message, so their posts still land it.'
                                  : 'The goal will be permanently removed.'
                              }
                              confirmLabel="Delete"
                              onConfirm={() => handleDelete(g.id)}
                              disabled={actionId === g.id}
                            >
                              <button
                                type="button"
                                disabled={actionId === g.id}
                                className="text-muted p-1 transition-colors hover:text-rose-500"
                                title="Delete goal"
                                aria-label={`Delete ${g.displayTitle}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </ConfirmPopover>
                          </div>
                        </div>

                        <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                          <p className="text-muted text-xs tabular-nums">
                            {usageLabel(usage[g.id])}
                          </p>
                          {g.isActive && (
                            <button
                              type="button"
                              onClick={() => setGenerateFor([g.id])}
                              className="border-border text-foreground hover:bg-surface-hover inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors"
                            >
                              <Wand2 className="h-3.5 w-3.5" />
                              Generate ideas
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** "3 ideas · 1 post" for a goal's card. */
function usageLabel(usage: { ideas: number; posts: number } | undefined) {
  const ideas = usage?.ideas ?? 0
  const posts = usage?.posts ?? 0
  if (ideas === 0) return 'No ideas yet'
  return `${ideas} idea${ideas === 1 ? '' : 's'} · ${posts} post${posts === 1 ? '' : 's'}`
}
