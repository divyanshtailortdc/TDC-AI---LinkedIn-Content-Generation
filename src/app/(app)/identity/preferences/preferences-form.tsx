'use client'

import {
  useStepSave,
  useStepView
} from '@/components/account-setup/setup-frame'
import { PrefillBanner } from '@/components/ai-setup/prefill-banner'
import { useSectionPrefill } from '@/components/ai-setup/use-section-prefill'
import { showToast } from '@/components/toast-notification'
import {
  preferencesSuggestionValues,
  type PreferencesValues
} from '@/lib/settings-merge'
import { FileText, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { savePreferences, type PreferencesPayload } from './actions'

const IDEAS_PER_RUN_OPTIONS = [3, 4, 5, 6, 8, 10, 12]

const splitList = (value: string) =>
  value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

const inputClass =
  'border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm'

function Section({
  icon: Icon,
  title,
  description,
  action,
  children
}: {
  icon: typeof FileText
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="border-border bg-surface space-y-4 rounded-2xl border p-5 shadow-xs">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-foreground flex items-center gap-2.5 text-base font-semibold">
            <div className="bg-accent/10 rounded-lg p-1.5">
              <Icon className="text-accent h-4 w-4" />
            </div>
            {title}
          </h2>
          {description && (
            <p className="text-muted mt-0.5 text-xs">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function PreferencesForm({
  accountId,
  initial,
  hasSaved
}: {
  accountId: string
  initial: PreferencesPayload
  /** False until preferences are first saved, when every value is a default. */
  hasSaved: boolean
}) {
  const [ideasPerRun, setIdeasPerRun] = useState(initial.ideasPerRun)
  const [constraints, setConstraints] = useState(initial.post_constraints)
  const [bannedTopicsInput, setBannedTopicsInput] = useState(
    initial.guardrails.banned_topics.join(', ')
  )
  const [complianceNotes, setComplianceNotes] = useState(
    initial.guardrails.compliance_notes
  )

  const [error, setError] = useState<string | null>(null)

  // AI setup suggestions fill blank settings only; saving is still manual.
  const prefill = useSectionPrefill<PreferencesValues>({
    draftKey: accountId,
    section: 'preferences',
    getCurrent: () => ({
      bannedTopics: splitList(bannedTopicsInput),
      complianceNotes
    }),
    setValues: next => {
      if (next.bannedTopics !== undefined)
        setBannedTopicsInput(next.bannedTopics.join(', '))
      if (next.complianceNotes !== undefined)
        setComplianceNotes(next.complianceNotes)
    },
    suggestionValues: s => preferencesSuggestionValues(s.preferences),
    isBlank: () => !hasSaved
  })

  // Runs from the header's Save; false keeps the user on this step.
  const save = async (): Promise<boolean> => {
    setError(null)
    try {
      await savePreferences(accountId, {
        ideasPerRun,
        post_constraints: constraints,
        guardrails: {
          banned_topics: splitList(bannedTopicsInput),
          compliance_notes: complianceNotes
        }
      })
      showToast({
        type: 'success',
        title: 'Preferences Saved',
        message: 'Content preferences saved successfully.'
      })
      prefill.markSaved()
      return true
    } catch (err: any) {
      setError(err.message || 'Failed to save preferences')
      showToast({
        type: 'error',
        title: 'Save Failed',
        message: err.message || 'Failed to save preferences'
      })
      return false
    }
  }
  useStepSave(save)

  // The header's Cancel puts every setting back to what is saved.
  const resetToSaved = () => {
    prefill.undo()
    setIdeasPerRun(initial.ideasPerRun)
    setConstraints(initial.post_constraints)
    setBannedTopicsInput(initial.guardrails.banned_topics.join(', '))
    setComplianceNotes(initial.guardrails.compliance_notes)
    setError(null)
  }
  // Settings the AI filled in are unsaved changes, so they keep the form open.
  const editing = useStepView({
    dirty: prefill.active && prefill.filled.length > 0,
    onCancel: resetToSaved
  })

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      <PrefillBanner section="preferences" prefill={prefill} />

      {/* 1. Posts */}
      <Section icon={FileText} title="Posts">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-foreground mb-1 block text-xs font-medium">
              Ideas per Run
            </label>
            <select
              value={ideasPerRun}
              onChange={e => setIdeasPerRun(Number(e.target.value))}
              className={inputClass}
            >
              {Array.from(new Set([...IDEAS_PER_RUN_OPTIONS, ideasPerRun]))
                .sort((a, b) => a - b)
                .map(n => (
                  <option key={n} value={n}>
                    {n} ideas
                  </option>
                ))}
            </select>
          </div>

          <label className={`mt-5 flex items-center gap-3 rounded-lg border p-3 ${
              editing
                ? 'border-border bg-surface-hover cursor-pointer'
                : 'cursor-default border-transparent px-0'
            }`}>
            <input
              type="checkbox"
              checked={constraints.cta_required}
              onChange={e =>
                setConstraints({
                  ...constraints,
                  cta_required: e.target.checked
                })
              }
              className="accent-accent"
            />
            <span className="text-foreground text-xs font-medium">
              End every post with a call to action
            </span>
          </label>
        </div>
      </Section>

      {/* 2. Guardrails */}
      <Section icon={ShieldAlert} title="Things to Avoid">
        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            Topics to avoid
          </label>
          {/* Chrome's autofill read this as a vehicle licence plate and
              offered to save "politics"; none of these fields are personal
              details a browser should remember. */}
          <input
            type="text"
            autoComplete="off"
            value={bannedTopicsInput}
            onChange={e => setBannedTopicsInput(e.target.value)}
            placeholder="e.g. politics, competitor pricing"
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            Compliance notes (optional)
          </label>
          {/* Fixed height (~5 lines); longer notes scroll inside the box
              rather than clipping or stretching the page. */}
          <textarea
            autoComplete="off"
            value={complianceNotes}
            onChange={e => setComplianceNotes(e.target.value)}
            placeholder="e.g. Never mention client names without approval."
            className={`${inputClass} scrollbar-visible h-32 resize-none overflow-y-auto leading-relaxed wrap-break-word`}
          />
        </div>
      </Section>
    </div>
  )
}
