'use client'

import {
  applyIdentitySetupAction,
  getIdentitySetupBaselineAction,
  type IdentitySetupBaseline,
  type SectionApplyResult
} from '@/app/(app)/identity/ai-setup-actions'
import { showToast } from '@/components/toast-notification'
import {
  EMPTY_SUGGESTIONS,
  FIELD_SPECS,
  fieldLabel,
  getSectionStatus,
  GoalSuggestionsSchema,
  PreferencesSuggestionsSchema,
  ProfileSuggestionsSchema,
  SECTION_LABELS,
  VoiceSuggestionsSchema,
  type IdentitySetupSuggestions,
  type SectionStatus,
  type SetupSection
} from '@/lib/ai/skills/profile-setup/schema'
import { isEmptyValue } from '@/lib/settings-merge'
import { normalizeUrlForCompare } from '@/lib/urls'
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Loader2,
  Pencil,
  X,
  XCircle
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { updateDraftSuggestions, type IdentitySetupDraft } from './draft-store'

type EntrySection = Exclude<SetupSection, 'knowledge'>
/** Sections whose fields are applied one by one; a goal is all or nothing. */
type FieldSection = 'profile' | 'voice' | 'preferences'

const FIELD_SECTIONS: FieldSection[] = ['profile', 'voice', 'preferences']

const SECTION_SCHEMAS = {
  profile: ProfileSuggestionsSchema,
  voice: VoiceSuggestionsSchema,
  goals: GoalSuggestionsSchema,
  preferences: PreferencesSuggestionsSchema
} as const

const LONG_TEXT_FIELDS = new Set([
  'description',
  'targetAudience',
  'offerings',
  'derivedStyleRubric',
  'keyMessage',
  'complianceNotes'
])

export type Item = {
  value: unknown
  kind: 'fact' | 'recommendation'
  source?: string
  /** Why the AI suggested it; an edited value has none. */
  note?: string
}

type Pillar = NonNullable<
  IdentitySetupSuggestions['preferences']['pillars']
>['value'][number]

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand'

/** Raw form, for telling whether a suggestion differs from what is saved. */
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

function specFor(section: EntrySection, field: string) {
  return (
    FIELD_SPECS[section] as Record<
      string,
      { type: string; options?: readonly string[] }
    >
  )[field]
}

/** How a value reads in the list. */
function displayValue(
  section: EntrySection,
  field: string,
  value: unknown
): string {
  const spec = specFor(section, field)
  if (spec?.type === 'scale' && typeof value === 'number') return `${value} / 5`
  const text = formatValue(value)
  return spec?.options ? text.replace(/_/g, ' ') : text
}

function provenanceLabel(item: Item): string {
  if (item.source === 'edited') return 'Edited'
  if (item.kind === 'recommendation') return 'AI recommendation'
  return /^https?:\/\//i.test(item.source ?? '')
    ? 'From a web page'
    : 'From your info'
}

export function itemOf(
  suggestions: IdentitySetupSuggestions,
  section: EntrySection,
  field: string
): Item {
  return (suggestions[section] as unknown as Record<string, Item>)[field]!
}

function suggestedFieldNames(
  section: EntrySection,
  suggestions: IdentitySetupSuggestions
): string[] {
  const data = suggestions[section] as Record<string, unknown>
  return [
    ...(section === 'preferences' ? ['pillars'] : []),
    ...Object.keys(FIELD_SPECS[section])
  ].filter(field => data[field])
}

function savedValueFor(
  baseline: IdentitySetupBaseline | null,
  section: EntrySection,
  field: string
): unknown {
  if (!baseline) return undefined
  if (section === 'profile')
    return baseline.profile[field as keyof IdentitySetupBaseline['profile']]
  if (section === 'voice' && baseline.hasVoice) {
    return baseline.voice[field as keyof IdentitySetupBaseline['voice']]
  }
  if (section === 'preferences' && baseline.hasPreferences) {
    return baseline.preferences[
      field as keyof IdentitySetupBaseline['preferences']
    ]
  }
  return undefined
}

/** Whether a suggestion says what is already saved, so there is nothing to change. */
function matchesSaved(
  baseline: IdentitySetupBaseline | null,
  suggestions: IdentitySetupSuggestions,
  section: EntrySection,
  field: string
): boolean {
  const saved = savedValueFor(baseline, section, field)
  return (
    !isEmptyValue(saved) &&
    formatValue(saved) === formatValue(itemOf(suggestions, section, field).value)
  )
}

/**
 * Takes suggestions that match the saved settings out of the draft. They never
 * show in the review window, and left in the draft they kept the card on "View
 * AI suggestions" (and sections on "Needs more info") with nothing to review.
 */
function dropSuggestionsMatchingSaved(
  accountId: string,
  baseline: IdentitySetupBaseline
) {
  const saved = new Set(baseline.knowledgeUrls.map(normalizeUrlForCompare))
  updateDraftSuggestions(accountId, s => {
    let changed = false
    const next = { ...s }
    for (const section of FIELD_SECTIONS) {
      const matching = suggestedFieldNames(section, s).filter(field =>
        matchesSaved(baseline, s, section, field)
      )
      if (matching.length === 0) continue
      const rest = { ...s[section] } as Record<string, unknown>
      for (const field of matching) delete rest[field]
      ;(next as Record<string, unknown>)[section] = rest
      changed = true
    }
    const sources = s.knowledge.sources.filter(
      src => !src.url || !saved.has(normalizeUrlForCompare(src.url))
    )
    if (sources.length !== s.knowledge.sources.length) {
      next.knowledge = { ...s.knowledge, sources }
      changed = true
    }
    return changed ? next : s
  })
}

/** Compares a fresh draft with what is saved and drops what already matches. */
export async function pruneDraftAgainstSaved(accountId: string) {
  try {
    const res = await getIdentitySetupBaselineAction(accountId)
    if (res.success) dropSuggestionsMatchingSaved(accountId, res.data)
  } catch {
    // The review window compares again when it opens.
  }
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
// Editing one suggestion. Edits stay in the dialog until Apply, and are
// checked with the same schema the server uses.
// ---------------------------------------------------------------------------

function parseEditorText(
  section: EntrySection,
  field: string,
  text: string
): unknown {
  const spec = specFor(section, field)
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

export function validateField(
  section: EntrySection,
  field: string,
  value: unknown
): string | null {
  if (isEmptyValue(value)) return 'Enter a value, or uncheck this change.'
  const schema = SECTION_SCHEMAS[section].shape as Record<
    string,
    {
      safeParse: (v: unknown) => {
        success: boolean
        error?: { issues: Array<{ message: string }> }
      }
    }
  >
  const result = schema[field]?.safeParse({
    value,
    kind: 'fact',
    source: 'edited',
    confidence: 'high'
  })
  if (result?.success) return null
  return result?.error?.issues[0]?.message || 'That value is not valid here.'
}

function FieldEditor({
  id,
  section,
  field,
  value,
  onCommit
}: {
  id: string
  section: EntrySection
  field: string
  value: unknown
  onCommit: (value: unknown) => string | null
}) {
  const spec = specFor(section, field)
  const [text, setText] = useState(() =>
    Array.isArray(value)
      ? value.join('\n')
      : value === undefined
        ? ''
        : String(value)
  )
  const [error, setError] = useState<string | null>(null)

  const change = (next: string) => {
    setText(next)
    setError(onCommit(parseEditorText(section, field, next)))
  }

  const invalid = error ? 'border-red-500/60 ring-1 ring-red-500/30' : ''
  let control: ReactNode
  if (spec?.type === 'scale') {
    control = (
      <select
        id={id}
        value={text}
        onChange={e => change(e.target.value)}
        className={`${inputClass} ${invalid}`}
      >
        {[1, 2, 3, 4, 5].map(n => (
          <option key={n} value={n}>
            {n} / 5
          </option>
        ))}
      </select>
    )
  } else if (spec?.type === 'enum') {
    control = (
      <select
        id={id}
        value={text}
        onChange={e => change(e.target.value)}
        className={`${inputClass} ${invalid}`}
      >
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
      <div id={id} className="flex flex-wrap gap-2">
        {spec.options.map(option => (
          <label
            key={option}
            className="border-border inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs"
          >
            <input
              type="checkbox"
              className="accent-brand"
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
        id={id}
        rows={
          spec?.type === 'list'
            ? Math.min(6, Math.max(2, text.split('\n').length))
            : 3
        }
        value={text}
        onChange={e => change(e.target.value)}
        className={`${inputClass} ${invalid} resize-y`}
      />
    )
  } else {
    control = (
      <input
        id={id}
        value={text}
        onChange={e => change(e.target.value)}
        className={`${inputClass} ${invalid}`}
      />
    )
  }

  return (
    <div>
      {control}
      {spec?.type === 'list' && !spec.options && (
        <p className="text-muted mt-1 text-[11px]">One per line.</p>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}

function PillarsEditor({
  pillars,
  onCommit
}: {
  pillars: Pillar[]
  onCommit: (value: unknown) => string | null
}) {
  const [rows, setRows] = useState(pillars)
  const [error, setError] = useState<string | null>(null)
  const total = rows.reduce((sum, p) => sum + (Number(p.weight_pct) || 0), 0)

  const change = (next: Pillar[]) => {
    setRows(next)
    setError(onCommit(next))
  }

  return (
    <div className="space-y-2">
      {rows.map((pillar, index) => (
        <div
          key={index}
          className="border-border grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_5rem]"
        >
          <input
            value={pillar.name}
            onChange={e =>
              change(
                rows.map((p, i) =>
                  i === index ? { ...p, name: e.target.value } : p
                )
              )
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
                    i === index
                      ? {
                          ...p,
                          weight_pct: Math.round(Number(e.target.value) || 0)
                        }
                      : p
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
                    ? {
                        ...p,
                        example_topics: e.target.value
                          .split('\n')
                          .map(t => t.trim())
                          .filter(Boolean)
                      }
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
      {error && total === 100 && (
        <p className="text-xs text-red-500">{error}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Showing values
// ---------------------------------------------------------------------------

/** A value as text, clamped to a few lines with Show more when it is long. */
function ValueText({
  section,
  field,
  value,
  muted = false
}: {
  section: EntrySection
  field: string
  value: unknown
  muted?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  if (field === 'pillars' && Array.isArray(value)) {
    return (
      <ul
        className={`space-y-0.5 text-sm ${muted ? 'text-muted' : 'text-foreground'}`}
      >
        {(value as Pillar[]).map(pillar => (
          <li key={pillar.name} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{pillar.name}</span>
            <span className="text-muted shrink-0 tabular-nums">
              {pillar.weight_pct}%
            </span>
          </li>
        ))}
      </ul>
    )
  }
  const text = displayValue(section, field, value)
  const long = text.length > 180
  return (
    <div>
      <p
        className={`text-sm leading-relaxed wrap-break-word whitespace-pre-wrap ${
          muted ? 'text-muted' : 'text-foreground'
        } ${long && !expanded ? 'line-clamp-3' : ''}`}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-brand-strong mt-0.5 text-xs font-medium hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

/** One bordered group of rows, with an optional select-all checkbox. */
export function SectionCard({
  title,
  note,
  selectAll,
  children
}: {
  title: string
  note?: string
  selectAll?: {
    checked: number
    total: number
    disabled?: boolean
    onChange: (checked: boolean) => void
    /** A goal is one change: its checkbox reads "add", not "n of m". */
    label?: string
  }
  children: ReactNode
}) {
  const all = selectAll ? selectAll.checked === selectAll.total : false
  const some = selectAll ? selectAll.checked > 0 && !all : false
  return (
    <section className="border-border overflow-hidden rounded-xl border">
      <header
        className={`bg-surface-hover/40 border-border flex items-center gap-3 px-4 py-2.5 ${
          children ? 'border-b' : ''
        }`}
      >
        {selectAll && (
          <input
            type="checkbox"
            ref={el => {
              if (el) el.indeterminate = some
            }}
            checked={all}
            disabled={selectAll.disabled}
            onChange={e => selectAll.onChange(e.target.checked)}
            aria-label={selectAll.label ?? `Select all ${title} changes`}
            className="accent-brand h-4 w-4 shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground text-sm font-semibold">{title}</h3>
          {note && <p className="text-muted text-xs">{note}</p>}
        </div>
        {selectAll && !selectAll.label && (
          <span className="text-muted shrink-0 text-xs tabular-nums">
            {selectAll.checked} of {selectAll.total}
          </span>
        )}
      </header>
      {children && <ul className="divide-border divide-y">{children}</ul>}
    </section>
  )
}

export function SuggestionRow({
  section,
  field,
  accountType,
  item,
  current,
  checked,
  selectable,
  editing,
  disabled,
  tag,
  onToggle,
  onCommit
}: {
  section: EntrySection
  field: string
  /** The identity type the suggestion was written for; names the company field. */
  accountType?: 'personal' | 'company'
  item: Item
  /** What is there now; undefined when the field is empty. */
  current: unknown
  checked: boolean
  /** Goal fields go in together, so they have no checkbox of their own. */
  selectable: boolean
  editing: boolean
  disabled: boolean
  /** What applying does to the field; by default New or Replaces current. */
  tag?: { label: string; tone: 'new' | 'update' | 'replace' }
  onToggle: (checked: boolean) => void
  onCommit: (value: unknown) => string | null
}) {
  const id = useId()
  const checkboxId = `${id}-pick`
  const editorId = `${id}-edit`
  const hasCurrent = current !== undefined
  const shownTag = tag ?? {
    label: hasCurrent ? 'Replaces current' : 'New',
    tone: hasCurrent ? 'replace' : 'new'
  }
  const label =
    field === 'pillars'
      ? 'Content pillars'
      : fieldLabel(section, field, accountType)

  const suggestion = editing ? (
    field === 'pillars' ? (
      <PillarsEditor pillars={item.value as Pillar[]} onCommit={onCommit} />
    ) : (
      <FieldEditor
        id={editorId}
        section={section}
        field={field}
        value={item.value}
        onCommit={onCommit}
      />
    )
  ) : (
    <ValueText section={section} field={field} value={item.value} />
  )

  return (
    <li
      className={`flex gap-3 px-4 py-3.5 transition-colors ${
        checked && selectable
          ? 'bg-brand/5 shadow-[inset_2px_0_0_var(--color-brand)]'
          : ''
      }`}
    >
      {selectable ? (
        <input
          id={checkboxId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={e => onToggle(e.target.checked)}
          className="accent-brand mt-0.5 h-4 w-4 shrink-0"
        />
      ) : (
        <span aria-hidden className="w-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label
            htmlFor={selectable ? checkboxId : editing ? editorId : undefined}
            className="text-foreground text-sm font-medium"
          >
            {label}
          </label>
          <span className="text-muted text-xs">{provenanceLabel(item)}</span>
          {selectable && (
            <span
              className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                shownTag.tone === 'replace'
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  : shownTag.tone === 'update'
                    ? 'border-brand/40 text-brand-strong border'
                    : 'bg-brand/15 text-brand-strong'
              }`}
            >
              {shownTag.label}
            </span>
          )}
        </div>
        {item.note && <p className="text-muted text-xs">{item.note}</p>}

        {hasCurrent ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="border-border rounded-lg border px-3 py-2">
              <p className="text-muted mb-1 text-[11px] font-medium tracking-wide uppercase">
                Current
              </p>
              <ValueText
                section={section}
                field={field}
                value={current}
                muted
              />
            </div>
            <div className="border-brand/40 bg-brand/5 rounded-lg border px-3 py-2">
              <p className="text-brand-strong mb-1 text-[11px] font-medium tracking-wide uppercase">
                Suggested
              </p>
              {suggestion}
            </div>
          </div>
        ) : (
          suggestion
        )}
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

/**
 * The review window's frame: overlay, header, a scrolling body and a footer.
 * Escape and a click outside close it unless `busy`.
 */
export function ReviewShell({
  title,
  description,
  busy = false,
  onClose,
  footer,
  children
}: {
  title: string
  description: string
  busy?: boolean
  onClose: () => void
  footer: ReactNode
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panel.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-ai-title"
      aria-describedby="review-ai-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={e => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="border-border bg-surface flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border shadow-2xl outline-none"
      >
        <div className="border-border flex items-start justify-between gap-4 border-b px-6 py-5">
          <div>
            <h2
              id="review-ai-title"
              className="text-foreground text-base font-semibold"
            >
              {title}
            </h2>
            <p id="review-ai-description" className="text-muted mt-1 text-sm">
              {description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="text-muted hover:bg-surface-hover hover:text-foreground rounded-lg p-1.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
          {children}
        </div>

        <div className="border-border flex flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          {footer}
        </div>
      </div>
    </div>
  )
}

/** Cancel, Edit Suggestions and Apply Selected Changes, with a short status. */
export function ReviewActions({
  status,
  editing,
  editDisabled,
  onToggleEdit,
  onCancel,
  onApply,
  applyDisabled,
  applying = false
}: {
  status: string
  editing: boolean
  editDisabled: boolean
  onToggleEdit: () => void
  onCancel: () => void
  onApply: () => void
  applyDisabled: boolean
  applying?: boolean
}) {
  return (
    <>
      <p className="text-muted text-xs" aria-live="polite">
        {status}
      </p>
      <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex sm:items-center">
        <button
          type="button"
          onClick={onCancel}
          disabled={applying}
          className="text-muted hover:text-foreground hover:bg-surface-hover h-8 rounded-lg px-3.5 text-[13px] font-medium transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onToggleEdit}
          disabled={applying || editDisabled}
          aria-pressed={editing}
          className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors disabled:opacity-60 ${
            editing
              ? 'border-brand/50 bg-brand/10 text-brand-strong'
              : 'border-border text-foreground hover:bg-surface-hover'
          }`}
        >
          <Pencil className="h-3.5 w-3.5" />
          {editing ? 'Done Editing' : 'Edit Suggestions'}
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={applying || applyDisabled}
          className="bg-accent hover:bg-accent-hover text-background order-first col-span-2 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:order-last"
        >
          {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {applying ? 'Applying…' : 'Apply Selected Changes'}
        </button>
      </div>
    </>
  )
}

function pickFields<T extends Record<string, unknown>>(
  data: T,
  fields: string[]
): T {
  return {
    missing: [],
    ...Object.fromEntries(fields.map(field => [field, data[field]]))
  } as unknown as T
}

/**
 * Lists the AI suggestions that would change something, each with a checkbox.
 * Nothing is written until Apply Selected Changes, and only the checked
 * fields are sent: everything else keeps its saved value. Edits made here are
 * dropped on Cancel.
 */
export function ReviewSuggestionsDialog({
  accountId,
  draft,
  onClose
}: {
  accountId: string
  draft: IdentitySetupDraft
  onClose: () => void
}) {
  const router = useRouter()
  const original = draft.suggestions
  const [edited, setEdited] = useState(original)
  const [baseline, setBaseline] = useState<IdentitySetupBaseline | null>(null)
  const [baselineError, setBaselineError] = useState<string | null>(null)
  // The user's own ticks; anything else follows the default for its row.
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [goalPicked, setGoalPicked] = useState<boolean | null>(null)
  const [knowledgeUrls, setKnowledgeUrls] = useState<Set<string>>(new Set())
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [results, setResults] = useState<Partial<
    Record<SetupSection, SectionApplyResult>
  > | null>(null)

  useEffect(() => {
    let cancelled = false
    getIdentitySetupBaselineAction(accountId)
      .then(res => {
        if (cancelled) return
        if (res.success) {
          setBaseline(res.data)
          const saved = new Set(
            res.data.knowledgeUrls.map(normalizeUrlForCompare)
          )
          setKnowledgeUrls(
            new Set(
              original.knowledge.sources
                .filter(
                  s =>
                    s.url &&
                    s.accessible &&
                    !saved.has(normalizeUrlForCompare(s.url))
                )
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

  const loading = !baseline && !baselineError

  // What matches the saved settings leaves the draft, so the card does not
  // keep offering suggestions that have nothing to apply.
  useEffect(() => {
    if (baseline) dropSuggestionsMatchingSaved(accountId, baseline)
  }, [baseline, accountId])

  // Rows that would change something: a suggestion equal to the saved value
  // is left out.
  const rows = Object.fromEntries(
    FIELD_SECTIONS.map(section => [
      section,
      suggestedFieldNames(section, original)
        .map(field => {
          const saved = savedValueFor(baseline, section, field)
          const current = isEmptyValue(saved) ? undefined : saved
          return { field, current }
        })
        .filter(
          ({ field, current }) =>
            current === undefined ||
            formatValue(current) !==
              formatValue(itemOf(original, section, field).value)
        )
    ])
  ) as Record<FieldSection, Array<{ field: string; current: unknown }>>

  // Replacing a saved value is opt-in. Without the saved values to compare
  // against, nothing is preselected.
  const isPicked = (section: FieldSection, field: string, current: unknown) =>
    picked[`${section}.${field}`] ?? (!baselineError && current === undefined)

  const chosen = Object.fromEntries(
    FIELD_SECTIONS.map(section => [
      section,
      rows[section]
        .filter(row => isPicked(section, row.field, row.current))
        .map(row => row.field)
    ])
  ) as Record<FieldSection, string[]>

  const goalStatus = getSectionStatus(original, 'goals')
  const goalReady = goalStatus.state === 'ready'
  const goalTitle = String(edited.goals.title?.value ?? '').trim()
  const goalExists = Boolean(
    goalTitle &&
    baseline?.goalTitles.some(
      t => t.trim().toLowerCase() === goalTitle.toLowerCase()
    )
  )
  const includeGoal = goalReady && (goalPicked ?? !goalExists)

  const savedKnowledge = new Set(
    (baseline?.knowledgeUrls || []).map(normalizeUrlForCompare)
  )
  const sources = original.knowledge.sources.filter(
    s => s.url && !savedKnowledge.has(normalizeUrlForCompare(s.url))
  )

  const changeCount =
    FIELD_SECTIONS.reduce((sum, s) => sum + chosen[s].length, 0) +
    (includeGoal ? 1 : 0) +
    knowledgeUrls.size
  const totalCount =
    FIELD_SECTIONS.reduce((sum, s) => sum + rows[s].length, 0) +
    (goalReady ? 1 : 0) +
    sources.length
  const blockingInvalid = [...invalid].some(key => {
    const [section, field] = key.split('.') as [EntrySection, string]
    return section === 'goals'
      ? includeGoal
      : chosen[section as FieldSection]?.includes(field)
  })

  const commit = (
    section: EntrySection,
    field: string,
    value: unknown
  ): string | null => {
    const key = `${section}.${field}`
    const problem = validateField(section, field, value)
    setInvalid(prev => {
      const next = new Set(prev)
      if (problem) next.add(key)
      else next.delete(key)
      return next
    })
    if (problem) return problem
    setEdited(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: { value, kind: 'fact', source: 'edited', confidence: 'high' }
      }
    }))
    // Editing a suggestion means wanting it.
    if (section === 'goals') setGoalPicked(true)
    else setPicked(prev => ({ ...prev, [key]: true }))
    return null
  }

  const apply = async () => {
    setApplying(true)
    setApplyError(null)
    const payload: IdentitySetupSuggestions = {
      ...EMPTY_SUGGESTIONS,
      profile: pickFields(edited.profile, chosen.profile),
      voice: pickFields(edited.voice, chosen.voice),
      preferences: pickFields(edited.preferences, chosen.preferences),
      goals: includeGoal ? edited.goals : EMPTY_SUGGESTIONS.goals,
      // The server only ingests URLs that were among these sources.
      knowledge: original.knowledge
    }
    try {
      const res = await applyIdentitySetupAction({
        accountId,
        suggestions: payload,
        sections: {
          // Only checked fields are sent, so replacing them is what was asked.
          profile: chosen.profile.length ? { mode: 'replace' } : undefined,
          voice: chosen.voice.length ? { mode: 'replace' } : undefined,
          preferences: chosen.preferences.length
            ? { mode: 'replace' }
            : undefined,
          goals: includeGoal || undefined,
          knowledgeUrls: knowledgeUrls.size > 0 ? [...knowledgeUrls] : undefined
        }
      })
      if (!res.success) {
        setApplyError(res.error)
        return
      }

      // What went in leaves the draft; anything left unchecked or failed
      // stays for another review.
      const outcome = res.results
      const done = (section: SetupSection) =>
        outcome[section] && outcome[section]!.status !== 'failed'
      // Sources are added one by one, so only those reported saved leave.
      const savedUrls = new Set(outcome.knowledge?.savedUrls ?? [])
      updateDraftSuggestions(accountId, s => {
        const next = { ...s }
        for (const section of FIELD_SECTIONS) {
          if (!done(section)) continue
          const rest = { ...s[section] } as Record<string, unknown>
          for (const field of chosen[section]) delete rest[field]
          // Fields that already matched were not offered, so they go too.
          for (const field of suggestedFieldNames(section, s)) {
            if (!rows[section].some(row => row.field === field)) {
              delete rest[field]
            }
          }
          ;(next as Record<string, unknown>)[section] = rest
        }
        if (outcome.goals?.status === 'applied') {
          next.goals = EMPTY_SUGGESTIONS.goals
        }
        if (savedUrls.size > 0) {
          next.knowledge = {
            ...s.knowledge,
            sources: s.knowledge.sources.filter(
              src => !src.url || !savedUrls.has(src.url)
            )
          }
        }
        return next
      })
      router.refresh()

      const incomplete = Object.values(outcome).filter(
        r => r.status === 'failed' || r.status === 'partial'
      )
      if (incomplete.length > 0) {
        setResults(outcome)
        return
      }
      const left = totalCount - changeCount
      showToast({
        type: 'success',
        title: `${changeCount} change${changeCount === 1 ? '' : 's'} applied`,
        message:
          left > 0
            ? `${left} suggestion${left === 1 ? ' was' : 's were'} left as ${left === 1 ? 'it was' : 'they were'}. No run was started.`
            : 'No run was started.'
      })
      onClose()
    } catch {
      setApplyError('Could not reach the server. Please try again.')
    } finally {
      setApplying(false)
    }
  }

  const fetched = draft.sources.filter(s => s.status === 'fetched').length
  const unread = draft.sources.length - fetched

  const body = results ? (
    <ul className="space-y-2">
      {(
        Object.entries(results) as Array<[SetupSection, SectionApplyResult]>
      ).map(([section, result]) => (
        <li
          key={section}
          className={`flex items-start gap-2.5 rounded-lg p-3 text-sm ${
            result.status === 'failed'
              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
              : result.status === 'partial'
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {result.status === 'failed' ? (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : result.status === 'partial' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>
            <span className="font-semibold">{SECTION_LABELS[section]}:</span>{' '}
            {result.message}
          </span>
        </li>
      ))}
    </ul>
  ) : loading ? (
    <p className="text-muted flex items-center justify-center gap-2 py-12 text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />
      Comparing with your current settings…
    </p>
  ) : totalCount === 0 && goalStatus.state === 'empty' ? (
    <p className="text-muted py-12 text-center text-sm">
      Your settings already match these suggestions. There is nothing to change.
    </p>
  ) : (
    <>
      {baselineError && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          {baselineError} Nothing is preselected; any field you check replaces
          what is saved.
        </p>
      )}

      {FIELD_SECTIONS.map(section =>
        rows[section].length === 0 ? null : (
          <SectionCard
            key={section}
            title={SECTION_LABELS[section]}
            selectAll={{
              checked: chosen[section].length,
              total: rows[section].length,
              disabled: applying,
              onChange: checked =>
                setPicked(prev => ({
                  ...prev,
                  ...Object.fromEntries(
                    rows[section].map(row => [
                      `${section}.${row.field}`,
                      checked
                    ])
                  )
                }))
            }}
          >
            {rows[section].map(({ field, current }) => (
              <SuggestionRow
                // A new analysis gets fresh editors.
                key={`${draft.id}-${section}.${field}`}
                section={section}
                field={field}
                accountType={draft.accountType}
                item={itemOf(edited, section, field)}
                current={current}
                checked={chosen[section].includes(field)}
                selectable
                editing={editing}
                disabled={applying}
                onToggle={checked =>
                  setPicked(prev => ({
                    ...prev,
                    [`${section}.${field}`]: checked
                  }))
                }
                onCommit={value => commit(section, field, value)}
              />
            ))}
          </SectionCard>
        )
      )}

      {goalStatus.state !== 'empty' && (
        <SectionCard
          title="New goal"
          note={
            !goalReady
              ? `Not enough to create a goal yet (missing ${goalStatus.missingRequired.join(', ')}).`
              : goalExists
                ? 'You already have a goal with this name.'
                : 'Adds a goal. Your existing goals are not changed.'
          }
          selectAll={
            goalReady
              ? {
                  checked: includeGoal ? 1 : 0,
                  total: 1,
                  disabled: applying,
                  label: 'Add this goal',
                  onChange: setGoalPicked
                }
              : undefined
          }
        >
          {goalReady
            ? suggestedFieldNames('goals', original).map(field => (
                <SuggestionRow
                  key={`${draft.id}-goals.${field}`}
                  section="goals"
                  field={field}
                  item={itemOf(edited, 'goals', field)}
                  current={undefined}
                  checked={includeGoal}
                  selectable={false}
                  editing={editing}
                  disabled={applying}
                  onToggle={() => {}}
                  onCommit={value => commit('goals', field, value)}
                />
              ))
            : null}
        </SectionCard>
      )}

      {sources.length > 0 && (
        <SectionCard
          title="Knowledge"
          note="Adds these pages to your knowledge base."
          selectAll={{
            checked: knowledgeUrls.size,
            total: sources.length,
            disabled: applying,
            onChange: checked =>
              setKnowledgeUrls(new Set(checked ? sources.map(s => s.url!) : []))
          }}
        >
          {sources.map(source => {
            const url = source.url!
            const checked = knowledgeUrls.has(url)
            return (
              <li
                key={url}
                className={`flex gap-3 px-4 py-3.5 transition-colors ${
                  checked
                    ? 'bg-brand/5 shadow-[inset_2px_0_0_var(--color-brand)]'
                    : ''
                }`}
              >
                <input
                  id={`source-${url}`}
                  type="checkbox"
                  checked={checked}
                  disabled={applying}
                  onChange={e =>
                    setKnowledgeUrls(prev => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(url)
                      else next.delete(url)
                      return next
                    })
                  }
                  className="accent-brand mt-0.5 h-4 w-4 shrink-0"
                />
                <label htmlFor={`source-${url}`} className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-sm font-medium">
                    {source.title}
                  </span>
                  <span className="text-muted block truncate text-xs">
                    {url}
                    {!source.accessible && ' · read when added'}
                  </span>
                </label>
              </li>
            )
          })}
        </SectionCard>
      )}

      {(fetched > 0 || unread > 0 || draft.warnings.length > 0) && (
        <details className="text-muted text-xs">
          <summary className="hover:text-foreground w-fit cursor-pointer">
            {[
              fetched > 0 && `${fetched} page${fetched === 1 ? '' : 's'} read`,
              unread > 0 && `${unread} couldn't be read`,
              // Unverified suggestions and Advanced choices that could not be used.
              draft.warnings.length > 0 &&
                `${draft.warnings.length} item${draft.warnings.length === 1 ? '' : 's'} left out`
            ]
              .filter(Boolean)
              .join(' · ')}
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {draft.sources.map(source => (
              <li key={source.url}>
                {source.url}{' '}
                {source.status === 'fetched'
                  ? 'was read.'
                  : `could not be read. ${source.reason ?? ''}`}
              </li>
            ))}
            {draft.warnings.map(w => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  )

  return (
    <ReviewShell
      title={
        results ? 'Some changes were not applied' : 'Review AI suggestions'
      }
      description={
        results
          ? 'Anything that failed stays in your suggestions, so you can try again.'
          : 'Choose the changes to apply. Anything you leave unchecked keeps its current value.'
      }
      busy={applying}
      onClose={onClose}
      footer={
        results ? (
          <>
            <span />
            <button
              type="button"
              onClick={onClose}
              className="bg-accent hover:bg-accent-hover text-background h-8 rounded-lg px-3.5 text-[13px] font-semibold shadow-sm transition-colors"
            >
              Done
            </button>
          </>
        ) : (
          <ReviewActions
            status={
              blockingInvalid
                ? 'Fix the highlighted values first.'
                : loading
                  ? ''
                  : `${changeCount} of ${totalCount} change${totalCount === 1 ? '' : 's'} selected`
            }
            editing={editing}
            editDisabled={loading || totalCount === 0}
            onToggleEdit={() => setEditing(!editing)}
            onCancel={onClose}
            onApply={apply}
            applyDisabled={loading || changeCount === 0 || blockingInvalid}
            applying={applying}
          />
        )
      }
    >
      {body}
      {applyError && (
        <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          {applyError}
        </p>
      )}
    </ReviewShell>
  )
}
