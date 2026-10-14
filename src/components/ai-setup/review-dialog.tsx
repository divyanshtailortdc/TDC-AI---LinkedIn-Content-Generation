'use client'

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  ExternalLink,
  Loader2,
  X,
  XCircle
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { showToast } from '@/components/toast-notification'
import {
  applyIdentitySetupAction,
  getIdentitySetupBaselineAction,
  type IdentitySetupBaseline,
  type SectionApplyResult
} from '@/app/(app)/accounts/ai-setup-actions'
import { isEmptyValue, type MergeMode } from '@/lib/settings-merge'
import {
  EMPTY_SUGGESTIONS,
  FIELD_SPECS,
  getSectionStatus,
  GoalSuggestionsSchema,
  PreferencesSuggestionsSchema,
  ProfileSuggestionsSchema,
  SECTION_LABELS,
  SETUP_SECTIONS,
  VoiceSuggestionsSchema,
  type IdentitySetupSuggestions,
  type SectionStatus,
  type SetupSection
} from '@/lib/ai/skills/profile-setup/schema'
import { normalizeUrlForCompare } from '@/lib/urls'
import {
  clearDraft,
  updateDraftSuggestions,
  type IdentitySetupDraft
} from './draft-store'
import { ProvenanceBadge } from './prefill-banner'

type EntrySection = Exclude<SetupSection, 'knowledge'>

const SECTION_SCHEMAS = {
  profile: ProfileSuggestionsSchema,
  voice: VoiceSuggestionsSchema,
  goals: GoalSuggestionsSchema,
  preferences: PreferencesSuggestionsSchema
} as const

const MERGEABLE: EntrySection[] = ['profile', 'voice', 'preferences']

const LONG_TEXT_FIELDS = new Set([
  'description',
  'targetAudience',
  'offerings',
  'derivedStyleRubric',
  'keyMessage',
  'complianceNotes'
])

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent'

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map(item =>
        item && typeof item === 'object'
          ? 'format' in item
            ? String((item as { format: string }).format)
            : 'name' in item
              ? `${(item as { name: string }).name} (${(item as { weight_pct?: number }).weight_pct ?? 0}%)`
              : JSON.stringify(item)
          : String(item)
      )
      .join(', ')
  }
  return value === null || value === undefined ? '' : String(value)
}

export function StatusChip({ status }: { status: SectionStatus }) {
  if (status.state === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> Ready
      </span>
    )
  }
  if (status.state === 'partial') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
        <CircleDot className="h-3 w-3" /> Needs more info
      </span>
    )
  }
  return (
    <span className="bg-surface-hover text-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold">
      <CircleDashed className="h-3 w-3" /> No suggestions
    </span>
  )
}

// ---------------------------------------------------------------------------
// Editing one field. Edits are validated with the same schema the server
// uses, and only valid values are written back to the draft.
// ---------------------------------------------------------------------------

function parseEditorText(section: EntrySection, field: string, text: string): unknown {
  if (field === 'pillars') return undefined
  const spec = (FIELD_SPECS[section] as Record<string, { type: string; options?: readonly string[] }>)[field]
  if (!spec) return text
  if (spec.type === 'scale') return text ? Number(text) : undefined
  if (spec.type === 'list') {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  }
  return text.trim()
}

function commitField(
  draftKey: string,
  section: EntrySection,
  field: string,
  value: unknown
): string | null {
  if (isEmptyValue(value)) {
    updateDraftSuggestions(draftKey, s => {
      const next = { ...s[section] } as Record<string, unknown>
      delete next[field]
      return { ...s, [section]: next }
    })
    return null
  }
  const candidate = { value, kind: 'fact' as const, source: 'edited', confidence: 'high' as const }
  const schema = SECTION_SCHEMAS[section].shape as Record<
    string,
    { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ message: string }> } } }
  >
  const result = schema[field]?.safeParse(candidate)
  if (!result?.success) {
    return result?.error?.issues[0]?.message || 'That value is not valid here.'
  }
  updateDraftSuggestions(draftKey, s => ({
    ...s,
    [section]: { ...s[section], [field]: candidate }
  }))
  return null
}

function FieldEditor({
  draftKey,
  section,
  field,
  value,
  onValidityChange
}: {
  draftKey: string
  section: EntrySection
  field: string
  value: unknown
  onValidityChange: (invalid: boolean) => void
}) {
  const spec = (FIELD_SPECS[section] as Record<string, { type: string; options?: readonly string[] }>)[field]
  const [text, setText] = useState(() =>
    Array.isArray(value) ? value.join('\n') : value === undefined ? '' : String(value)
  )
  const [error, setError] = useState<string | null>(null)

  const change = (next: string) => {
    setText(next)
    const problem = commitField(draftKey, section, field, parseEditorText(section, field, next))
    setError(problem)
    onValidityChange(problem !== null)
  }

  let control: React.ReactNode
  if (spec?.type === 'scale') {
    control = (
      <select value={text} onChange={e => change(e.target.value)} className={inputClass}>
        {[1, 2, 3, 4, 5].map(n => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    )
  } else if (spec?.type === 'enum') {
    control = (
      <select value={text} onChange={e => change(e.target.value)} className={inputClass}>
        {spec.options!.map(option => (
          <option key={option} value={option}>
            {option.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    )
  } else if (spec?.type === 'list' && spec.options) {
    const selected = new Set(text.split('\n').filter(Boolean))
    control = (
      <div className="flex flex-wrap gap-2">
        {spec.options.map(option => (
          <label key={option} className="border-border inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs">
            <input
              type="checkbox"
              checked={selected.has(option)}
              onChange={e => {
                const next = new Set(selected)
                if (e.target.checked) next.add(option)
                else next.delete(option)
                change(spec.options!.filter(o => next.has(o)).join('\n'))
              }}
            />
            {option.replace(/_/g, ' ')}
          </label>
        ))}
      </div>
    )
  } else if (spec?.type === 'list' || LONG_TEXT_FIELDS.has(field)) {
    control = (
      <textarea
        rows={spec?.type === 'list' ? Math.min(6, Math.max(2, text.split('\n').length)) : 3}
        value={text}
        onChange={e => change(e.target.value)}
        className={`${inputClass} resize-y`}
      />
    )
  } else {
    control = (
      <input value={text} onChange={e => change(e.target.value)} className={inputClass} />
    )
  }

  return (
    <div>
      {control}
      {spec?.type === 'list' && !spec.options && (
        <p className="text-muted mt-1 text-[10px]">One per line.</p>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}

type Pillar = NonNullable<IdentitySetupSuggestions['preferences']['pillars']>['value'][number]

function PillarsEditor({
  draftKey,
  pillars,
  onValidityChange
}: {
  draftKey: string
  pillars: Pillar[]
  onValidityChange: (invalid: boolean) => void
}) {
  const [rows, setRows] = useState(pillars)
  const [error, setError] = useState<string | null>(null)
  const total = rows.reduce((sum, p) => sum + (Number(p.weight_pct) || 0), 0)

  const change = (next: Pillar[]) => {
    setRows(next)
    const problem = commitField(draftKey, 'preferences', 'pillars', next)
    setError(problem)
    onValidityChange(problem !== null)
  }

  return (
    <div className="space-y-2">
      {rows.map((pillar, index) => (
        <div key={index} className="border-border grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_5rem]">
          <input
            value={pillar.name}
            onChange={e =>
              change(rows.map((p, i) => (i === index ? { ...p, name: e.target.value } : p)))
            }
            className={inputClass}
            aria-label="Pillar name"
          />
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={100}
              value={pillar.weight_pct}
              onChange={e =>
                change(
                  rows.map((p, i) =>
                    i === index ? { ...p, weight_pct: Math.round(Number(e.target.value) || 0) } : p
                  )
                )
              }
              className={inputClass}
              aria-label="Pillar weight"
            />
            <span className="text-muted text-xs">%</span>
          </div>
          <textarea
            rows={2}
            value={pillar.example_topics.join('\n')}
            onChange={e =>
              change(
                rows.map((p, i) =>
                  i === index
                    ? { ...p, example_topics: e.target.value.split('\n').map(t => t.trim()).filter(Boolean) }
                    : p
                )
              )
            }
            placeholder="Topics, one per line"
            className={`${inputClass} resize-y sm:col-span-2`}
          />
        </div>
      ))}
      <p className={`text-xs ${total === 100 ? 'text-muted' : 'text-red-500'}`}>
        Weights total {total}% (must be 100%).
      </p>
      {error && total === 100 && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

function savedValueFor(
  baseline: IdentitySetupBaseline | null,
  section: EntrySection,
  field: string
): unknown {
  if (!baseline) return undefined
  if (section === 'profile') return baseline.profile[field as keyof IdentitySetupBaseline['profile']]
  if (section === 'voice' && baseline.hasVoice) {
    return baseline.voice[field as keyof IdentitySetupBaseline['voice']]
  }
  if (section === 'preferences' && baseline.hasPreferences) {
    return baseline.preferences[field as keyof IdentitySetupBaseline['preferences']]
  }
  return undefined
}

export function ReviewSuggestionsDialog({
  accountId,
  draft,
  onClose,
  onEditDetails
}: {
  accountId: string
  draft: IdentitySetupDraft
  onClose: () => void
  onEditDetails: () => void
}) {
  const router = useRouter()
  const suggestions = draft.suggestions
  const [baseline, setBaseline] = useState<IdentitySetupBaseline | null>(null)
  const [baselineError, setBaselineError] = useState<string | null>(null)

  const [include, setInclude] = useState<Record<SetupSection, boolean>>(() =>
    Object.fromEntries(
      SETUP_SECTIONS.map(section => [
        section,
        section === 'goals'
          ? getSectionStatus(suggestions, section).state === 'ready'
          : section !== 'knowledge' && getSectionStatus(suggestions, section).state !== 'empty'
      ])
    ) as Record<SetupSection, boolean>
  )
  const [modes, setModes] = useState<Record<string, MergeMode>>({
    profile: 'fill-empty',
    voice: 'fill-empty',
    preferences: 'fill-empty'
  })
  const [knowledgeUrls, setKnowledgeUrls] = useState<Set<string>>(new Set())
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [results, setResults] = useState<Partial<Record<SetupSection, SectionApplyResult>> | null>(null)

  useEffect(() => {
    let cancelled = false
    getIdentitySetupBaselineAction(accountId)
      .then(res => {
        if (cancelled) return
        if (res.success) {
          setBaseline(res.data)
          const saved = new Set(res.data.knowledgeUrls.map(normalizeUrlForCompare))
          setKnowledgeUrls(
            new Set(
              suggestions.knowledge.sources
                .filter(s => s.url && s.accessible && !saved.has(normalizeUrlForCompare(s.url)))
                .map(s => s.url!)
            )
          )
        } else {
          setBaselineError(res.error)
        }
      })
      .catch(() => {
        if (!cancelled) setBaselineError('Could not load your saved settings.')
      })
    return () => {
      cancelled = true
    }
    // Baseline is loaded once per opening; edits must not refetch it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  const setFieldInvalid = (key: string, isInvalid: boolean) =>
    setInvalid(prev => {
      const next = new Set(prev)
      if (isInvalid) next.add(key)
      else next.delete(key)
      return next
    })

  const savedKnowledge = new Set((baseline?.knowledgeUrls || []).map(normalizeUrlForCompare))
  const blockingInvalid = [...invalid].some(key => include[key.split('.')[0] as SetupSection])
  const selectedCount =
    (['profile', 'voice', 'goals', 'preferences'] as const).filter(s => include[s]).length +
    (knowledgeUrls.size > 0 ? 1 : 0)

  const apply = async () => {
    setApplying(true)
    setApplyError(null)
    try {
      const res = await applyIdentitySetupAction({
        accountId,
        suggestions,
        sections: {
          profile: include.profile ? { mode: modes.profile! } : undefined,
          voice: include.voice ? { mode: modes.voice! } : undefined,
          preferences: include.preferences ? { mode: modes.preferences! } : undefined,
          goals: include.goals || undefined,
          knowledgeUrls: knowledgeUrls.size > 0 ? [...knowledgeUrls] : undefined
        }
      })
      if (!res.success) {
        setApplyError(res.error)
        return
      }
      setResults(res.results)

      // Applied sections leave the draft so forms don't prefill them again.
      const done = (Object.entries(res.results) as Array<[SetupSection, SectionApplyResult]>)
        .filter(([, r]) => r.status === 'applied')
        .map(([section]) => section)
      updateDraftSuggestions(accountId, s => {
        const next = { ...s }
        for (const section of done) {
          if (section === 'knowledge') {
            next.knowledge = {
              ...s.knowledge,
              sources: s.knowledge.sources.filter(src => !src.url || !knowledgeUrls.has(src.url))
            }
          } else {
            ;(next as Record<string, unknown>)[section] = EMPTY_SUGGESTIONS[section]
          }
        }
        return next
      })

      const failed = Object.values(res.results).filter(r => r.status === 'failed').length
      showToast({
        type: failed > 0 ? 'error' : 'success',
        title: failed > 0 ? 'Some suggestions were not applied' : 'Suggestions applied',
        message:
          failed > 0
            ? 'See the details in the review window.'
            : 'Review each tab before starting a run. No run was started.'
      })
      router.refresh()
    } catch {
      setApplyError('Could not reach the server. Please try again.')
    } finally {
      setApplying(false)
    }
  }

  const renderEntrySection = (section: EntrySection) => {
    const data = suggestions[section] as Record<string, unknown>
    const fields = [
      ...(section === 'preferences' ? ['pillars'] : []),
      ...Object.keys(FIELD_SPECS[section])
    ].filter(field => data[field])

    return fields.map(field => {
      const item = data[field] as { value: unknown; kind: 'fact' | 'recommendation'; source?: string; confidence: 'high' | 'medium' | 'low' }
      const saved = savedValueFor(baseline, section, field)
      const hasSaved = !isEmptyValue(saved) && formatValue(saved) !== formatValue(item.value)
      const mode = modes[section] ?? 'fill-empty'
      const key = `${section}.${field}`

      return (
        <div key={key} className="border-border/60 space-y-1.5 border-t pt-3 first:border-t-0 first:pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-foreground text-xs font-semibold">
              {field === 'pillars' ? 'Content pillars' : (FIELD_SPECS[section] as Record<string, { label: string }>)[field]?.label}
            </span>
            <ProvenanceBadge kind={item.kind} source={item.source} confidence={item.confidence} />
          </div>
          {field === 'pillars' ? (
            <PillarsEditor
              key={`${draft.id}-${key}`}
              draftKey={accountId}
              pillars={item.value as Pillar[]}
              onValidityChange={bad => setFieldInvalid(key, bad)}
            />
          ) : (
            <FieldEditor
              key={`${draft.id}-${key}`}
              draftKey={accountId}
              section={section}
              field={field}
              value={item.value}
              onValidityChange={bad => setFieldInvalid(key, bad)}
            />
          )}
          {hasSaved && (
            <p className="text-muted text-[11px]">
              Saved now: <span className="text-foreground">{formatValue(saved).slice(0, 160)}</span>
              {' — '}
              {MERGEABLE.includes(section) && mode === 'replace' ? (
                <span className="font-semibold text-amber-600 dark:text-amber-400">will be replaced</span>
              ) : (
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">will be kept</span>
              )}
            </p>
          )}
        </div>
      )
    })
  }

  const sectionNote: Partial<Record<SetupSection, string>> = {
    voice:
      'Recommended for your stated brand, not learned from your posts. To match how you really write, paste 5–15 posts on the Voice tab and use Analyze my voice.',
    goals: `Applying creates a new goal${baseline?.goalTitles.length ? `; your ${baseline.goalTitles.length} existing goal${baseline.goalTitles.length === 1 ? ' is' : 's are'} not changed` : ''}.`,
    preferences:
      'Emoji, hashtags and words to avoid are set in Voice. Ideas per run and the Schedule tab are not changed.',
    knowledge:
      'Checked sources are added through the normal Knowledge pipeline. Facts below were checked against their source text.'
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-ai-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={e => {
        if (e.target === e.currentTarget && !applying) onClose()
      }}
    >
      <div className="border-border bg-surface flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border shadow-2xl">
        <div className="border-border flex items-start justify-between gap-4 border-b p-6">
          <div>
            <h2 id="review-ai-title" className="text-foreground text-base font-bold">
              Review AI suggestions
            </h2>
            <p className="text-muted mt-1 text-xs">
              Edit anything below, choose what to apply, then confirm. By default
              only empty fields are filled and your saved values are kept.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            aria-label="Close"
            className="text-muted hover:bg-surface-hover hover:text-foreground rounded-lg p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-6">
          {baselineError && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              {baselineError} Saved values can&apos;t be shown, but applying still keeps them unless you choose Replace.
            </p>
          )}

          {(draft.sources.length > 0 || draft.warnings.length > 0) && (
            <div className="bg-surface-hover/50 space-y-2 rounded-xl p-4 text-xs">
              {draft.sources.map(source => (
                <p key={source.url} className="flex items-start gap-2">
                  {source.status === 'fetched' ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  )}
                  <span>
                    <span className="text-foreground font-medium">{source.url}</span>{' '}
                    <span className="text-muted">
                      {source.status === 'fetched' ? 'was read.' : `could not be read. ${source.reason ?? ''}`}
                    </span>
                  </span>
                </p>
              ))}
              {draft.warnings.length > 0 && (
                <details>
                  <summary className="text-muted cursor-pointer">
                    {draft.warnings.length} AI suggestion{draft.warnings.length === 1 ? ' was' : 's were'} dropped because {draft.warnings.length === 1 ? 'it' : 'they'} could not be verified
                  </summary>
                  <ul className="text-muted mt-2 list-disc space-y-1 pl-5">
                    {draft.warnings.map(w => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {SETUP_SECTIONS.map(section => {
            const status = getSectionStatus(suggestions, section)
            const result = results?.[section]
            const needs = [...status.missingRequired, ...status.missingInfo]
            const disabled = status.state === 'empty' || (section === 'goals' && status.state !== 'ready')

            return (
              <section key={section} className="border-border rounded-xl border">
                <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                  <div className="flex items-center gap-3">
                    {section !== 'knowledge' && (
                      <input
                        type="checkbox"
                        aria-label={`Apply ${SECTION_LABELS[section]}`}
                        checked={include[section] && !disabled}
                        disabled={disabled || applying}
                        onChange={e => setInclude(prev => ({ ...prev, [section]: e.target.checked }))}
                      />
                    )}
                    <h3 className="text-foreground text-sm font-semibold">{SECTION_LABELS[section]}</h3>
                    <StatusChip status={status} />
                  </div>
                  {MERGEABLE.includes(section as EntrySection) && status.state !== 'empty' && (
                    <select
                      value={modes[section]}
                      disabled={applying}
                      onChange={e => setModes(prev => ({ ...prev, [section]: e.target.value as MergeMode }))}
                      className="border-border bg-surface text-foreground rounded-lg border px-2 py-1 text-xs"
                      aria-label={`How to apply ${SECTION_LABELS[section]}`}
                    >
                      <option value="fill-empty">Fill empty fields only</option>
                      <option value="replace">Replace my saved values</option>
                    </select>
                  )}
                </header>

                <div className="space-y-3 p-4">
                  {sectionNote[section] && status.state !== 'empty' && (
                    <p className="text-muted text-xs">{sectionNote[section]}</p>
                  )}

                  {section === 'knowledge' ? (
                    <>
                      {suggestions.knowledge.sources.map(source => {
                        const already = source.url && savedKnowledge.has(normalizeUrlForCompare(source.url))
                        return (
                          <label key={`${source.title}-${source.url}`} className="flex items-start gap-3 text-xs">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              disabled={!source.url || Boolean(already) || applying}
                              checked={Boolean(source.url && knowledgeUrls.has(source.url))}
                              onChange={e =>
                                setKnowledgeUrls(prev => {
                                  const next = new Set(prev)
                                  if (e.target.checked) next.add(source.url!)
                                  else next.delete(source.url!)
                                  return next
                                })
                              }
                            />
                            <span className="space-y-0.5">
                              <span className="text-foreground block font-medium">
                                {source.title}{' '}
                                {source.url && (
                                  <a href={source.url} target="_blank" rel="noreferrer noopener" className="text-accent inline-flex items-center gap-0.5 font-normal">
                                    {source.url} <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </span>
                              <span className="text-muted block">
                                {source.reason}
                                {already ? ' Already in your knowledge base.' : !source.accessible ? ' Not read during analysis; it will be fetched when added.' : ''}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                      {suggestions.knowledge.facts.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-foreground text-xs font-semibold">Facts found</p>
                          {suggestions.knowledge.facts.map(fact => (
                            <div key={fact.quote} className="bg-surface-hover/50 rounded-lg p-3 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-foreground font-medium">{fact.statement}</span>
                                <ProvenanceBadge kind="fact" source={fact.source} />
                              </div>
                              <p className="text-muted mt-1 italic">&ldquo;{fact.quote}&rdquo;</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {suggestions.knowledge.suggestedAdditions.length > 0 && (
                        <div>
                          <p className="text-foreground text-xs font-semibold">Worth adding on the Knowledge tab</p>
                          <ul className="text-muted mt-1 list-disc space-y-0.5 pl-5 text-xs">
                            {suggestions.knowledge.suggestedAdditions.map(a => (
                              <li key={a}>{a}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    renderEntrySection(section)
                  )}

                  {needs.length > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Needs more information: {needs.join('; ')}
                    </p>
                  )}
                  {status.state === 'empty' && needs.length === 0 && !result && (
                    <p className="text-muted text-xs">Your description didn&apos;t give enough to suggest anything here.</p>
                  )}

                  {result && (
                    <p
                      className={`flex items-start gap-2 rounded-lg p-2.5 text-xs ${
                        result.status === 'applied'
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : result.status === 'failed'
                            ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                            : 'bg-surface-hover text-muted'
                      }`}
                    >
                      {result.status === 'failed' ? (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      )}
                      {result.message}
                    </p>
                  )}
                </div>
              </section>
            )
          })}

          {applyError && (
            <p className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {applyError}
            </p>
          )}
        </div>

        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t p-4">
          <p className="text-muted text-xs">
            {blockingInvalid ? 'Fix the highlighted values first.' : 'No generation run starts automatically.'}
          </p>
          <div className="flex items-center gap-2">
            {results ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    clearDraft(accountId)
                    onClose()
                  }}
                  className="text-muted hover:text-foreground rounded-lg px-4 py-2 text-sm font-medium"
                >
                  Discard the rest
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="bg-accent hover:bg-accent-hover text-background rounded-lg px-5 py-2 text-sm font-semibold"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={applying}
                  className="text-muted hover:text-foreground rounded-lg px-4 py-2 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onEditDetails}
                  disabled={applying}
                  className="border-border text-foreground hover:bg-surface-hover rounded-lg border px-4 py-2 text-sm font-medium"
                >
                  Edit Details
                </button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={applying || selectedCount === 0 || blockingInvalid}
                  className="bg-accent hover:bg-accent-hover text-background inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {applying && <Loader2 className="h-4 w-4 animate-spin" />}
                  {applying ? 'Applying…' : 'Apply Suggestions'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
