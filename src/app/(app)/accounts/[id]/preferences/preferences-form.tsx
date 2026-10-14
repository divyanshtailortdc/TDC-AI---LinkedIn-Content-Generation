'use client'

import { PrefillBanner } from '@/components/ai-setup/prefill-banner'
import { useSectionPrefill } from '@/components/ai-setup/use-section-prefill'
import { showToast } from '@/components/toast-notification'
import {
  preferencesSuggestionValues,
  type PreferencesValues
} from '@/lib/settings-merge'
import {
  FileText,
  Loader2,
  Plus,
  ShieldAlert,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  savePreferences,
  type PillarConfig,
  type PreferencesPayload
} from './actions'

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
  description: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="border-border bg-surface space-y-5 rounded-2xl border p-6 shadow-xs sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-foreground flex items-center gap-2.5 text-base font-semibold">
            <div className="bg-accent/10 rounded-lg p-1.5">
              <Icon className="text-accent h-4 w-4" />
            </div>
            {title}
          </h2>
          <p className="text-muted mt-0.5 text-xs">{description}</p>
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
  const router = useRouter()

  const [pillars, setPillars] = useState<PillarConfig[]>(initial.pillars)
  const [topicsInputs, setTopicsInputs] = useState<string[]>(
    initial.pillars.map(p => (p.example_topics || []).join(', '))
  )
  const [ideasPerRun, setIdeasPerRun] = useState(initial.ideasPerRun)
  const [constraints, setConstraints] = useState(initial.post_constraints)
  const [bannedTopicsInput, setBannedTopicsInput] = useState(
    initial.guardrails.banned_topics.join(', ')
  )
  const [complianceNotes, setComplianceNotes] = useState(
    initial.guardrails.compliance_notes
  )

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // AI setup suggestions fill blank settings only; saving is still manual.
  const prefill = useSectionPrefill<PreferencesValues>({
    draftKey: accountId,
    getCurrent: () => ({
      pillars: pillars.map((p, i) => ({
        ...p,
        example_topics: splitList(topicsInputs[i] || '')
      })),
      bannedTopics: splitList(bannedTopicsInput),
      complianceNotes
    }),
    setValues: next => {
      if (next.pillars !== undefined) {
        setPillars(next.pillars)
        setTopicsInputs(next.pillars.map(p => (p.example_topics || []).join(', ')))
      }
      if (next.bannedTopics !== undefined)
        setBannedTopicsInput(next.bannedTopics.join(', '))
      if (next.complianceNotes !== undefined)
        setComplianceNotes(next.complianceNotes)
    },
    suggestionValues: s => preferencesSuggestionValues(s.preferences),
    isBlank: () => !hasSaved
  })

  // Weights are relative; the server rebalances them to 100% on save.
  const totalWeight = pillars.reduce(
    (sum, p) => sum + Math.max(0, Number(p.weight_pct) || 0),
    0
  )
  const shareOf = (pillar: PillarConfig) =>
    totalWeight > 0
      ? Math.round(
          (Math.max(0, Number(pillar.weight_pct) || 0) / totalWeight) * 100
        )
      : Math.round(100 / pillars.length)

  const addPillar = () => {
    setPillars([...pillars, { name: '', weight_pct: 1, example_topics: [] }])
    setTopicsInputs([...topicsInputs, ''])
  }

  const updatePillar = (index: number, patch: Partial<PillarConfig>) => {
    setPillars(pillars.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  const removePillar = (index: number) => {
    setPillars(pillars.filter((_, i) => i !== index))
    setTopicsInputs(topicsInputs.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    setError(null)
    setIsSaving(true)

    try {
      await savePreferences(accountId, {
        pillars: pillars.map((p, i) => ({
          ...p,
          example_topics: splitList(topicsInputs[i] || '')
        })),
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
      router.push(`/accounts/${accountId}`)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to save preferences')
      showToast({
        type: 'error',
        title: 'Save Failed',
        message: err.message || 'Failed to save preferences'
      })
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="from-surface to-surface-hover border-border bg-linear-to relative overflow-hidden rounded-2xl border p-8 shadow-xs">
        <div className="relative z-10">
          <h1 className="text-foreground text-2xl font-bold tracking-tight">
            Preferences
          </h1>
          <p className="text-muted mt-2 max-w-2xl text-sm">
            What to post about and how many ideas you get. Tone, emoji, hashtags
            and words to avoid are set in{' '}
            <Link
              href={`/accounts/${accountId}/voice`}
              className="text-accent hover:underline"
            >
              Voice
            </Link>
            ; links, and where they go, on each{' '}
            <Link
              href={`/accounts/${accountId}/goals`}
              className="text-accent hover:underline"
            >
              Goal
            </Link>
            .
          </p>
        </div>
        <div className="pointer-events-none absolute top-0 right-0 p-8 opacity-10">
          <SlidersHorizontal className="h-32 w-32" />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      <PrefillBanner
        section="preferences"
        prefill={prefill}
        note="Ideas per run, the CTA setting and the Schedule tab are not changed."
      />

      {/* 1. Content pillars */}
      <Section
        icon={SlidersHorizontal}
        title="Content Pillars"
        description="The themes you post about. A bigger weight means more ideas on that theme."
        action={
          <button
            type="button"
            onClick={addPillar}
            className="text-accent hover:bg-accent/10 flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Pillar
          </button>
        }
      >
        {pillars.length === 0 ? (
          <div className="border-border text-muted rounded-xl border border-dashed p-6 text-center text-xs">
            No pillars yet. Ideas will follow your profile and goals until you
            add some.
          </div>
        ) : (
          <div className="space-y-3">
            {pillars.map((pillar, idx) => (
              <div
                key={idx}
                className="bg-surface-hover border-border space-y-2 rounded-xl border p-4"
              >
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={pillar.name}
                    onChange={e => updatePillar(idx, { name: e.target.value })}
                    placeholder="Pillar name (e.g. Lessons from client projects)"
                    className="border-border bg-surface text-foreground flex-1 rounded-md border px-3 py-1.5 text-sm font-semibold"
                  />
                  <label className="text-muted flex shrink-0 items-center gap-1.5 text-xs">
                    Weight
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={pillar.weight_pct}
                      onChange={e =>
                        updatePillar(idx, {
                          weight_pct: Number(e.target.value)
                        })
                      }
                      className="border-border bg-surface text-foreground w-16 rounded-md border px-2 py-1.5 text-center font-mono text-sm"
                    />
                  </label>
                  <span className="text-muted w-12 shrink-0 text-right font-mono text-xs">
                    ≈{shareOf(pillar)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => removePillar(idx)}
                    className="text-muted p-1 transition-colors hover:text-rose-500"
                    title="Remove pillar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <input
                  type="text"
                  value={topicsInputs[idx] || ''}
                  onChange={e =>
                    setTopicsInputs(
                      topicsInputs.map((t, i) =>
                        i === idx ? e.target.value : t
                      )
                    )
                  }
                  placeholder="Example topics, comma-separated (optional)"
                  className="border-border bg-surface text-foreground w-full rounded-md border px-3 py-1.5 text-xs"
                />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 2. Posts */}
      <Section
        icon={FileText}
        title="Posts"
        description="How many ideas each run suggests, and how posts end."
      >
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

          <label className="border-border bg-surface-hover mt-5 flex cursor-pointer items-center gap-3 rounded-lg border p-3">
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

      {/* 3. Guardrails */}
      <Section
        icon={ShieldAlert}
        title="Things to Avoid"
        description="Subjects the AI should never write about. Leave empty if you have none."
      >
        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            Topics to Avoid (comma-separated)
          </label>
          <input
            type="text"
            value={bannedTopicsInput}
            onChange={e => setBannedTopicsInput(e.target.value)}
            placeholder="e.g. politics, competitor pricing"
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            Compliance Notes (Optional)
          </label>
          {/* Fixed height (~5 lines); longer notes scroll inside the box
              rather than clipping or stretching the page. */}
          <textarea
            value={complianceNotes}
            onChange={e => setComplianceNotes(e.target.value)}
            placeholder="e.g. Never mention client names without approval."
            className={`${inputClass} scrollbar-visible h-32 resize-none overflow-y-auto leading-relaxed break-words`}
          />
        </div>
      </Section>

      {/* Save Button */}
      <div className="border-border flex justify-end border-t pt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="bg-accent hover:bg-accent-hover text-background flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium shadow-sm transition-colors disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving preferences…
            </>
          ) : (
            'Save Preferences →'
          )}
        </button>
      </div>
    </div>
  )
}
