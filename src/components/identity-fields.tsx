'use client'

import {
  IDENTITY_FIELDS,
  IdentityProfileSchema,
  type IdentityFieldDefinition,
  type IdentityProfileField
} from '@/lib/identity-profile'
import { Building2, Lock, Plus, Sparkles, User, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export type IdentityValues = Record<IdentityProfileField, string>
export type AccountType = 'personal' | 'company'

const ACCOUNT_TYPES: Array<{
  value: AccountType
  label: string
  description: string
  icon: typeof User
}> = [
  {
    value: 'personal',
    label: 'Person',
    description: 'You as an individual — founder, creator, or executive',
    icon: User
  },
  {
    value: 'company',
    label: 'Company / Product',
    description: 'A brand, agency, startup, or specific product',
    icon: Building2
  }
]

/**
 * Whether the AI writes as a person or as a brand. Chosen when the identity is
 * created; the edit page shows it locked, as it always has.
 */
function AccountTypePicker({
  value,
  onChange
}: {
  value: AccountType
  /** Leave out to show the choice read-only. */
  onChange?: (value: AccountType) => void
}) {
  const locked = !onChange
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-foreground text-sm font-medium">
          What kind of identity is this?
        </span>
        {locked && (
          <span className="text-muted inline-flex items-center gap-1 text-xs">
            <Lock className="h-3 w-3" />
            Set when the identity was created
          </span>
        )}
      </div>
      <input type="hidden" name="accountType" value={value} />
      <div
        role="radiogroup"
        aria-label="Identity type"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {ACCOUNT_TYPES.map(option => {
          const selected = option.value === value
          const Icon = option.icon
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={locked}
              onClick={() => onChange?.(option.value)}
              className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors ${
                selected
                  ? 'border-accent bg-accent/5 ring-accent/20 ring-1'
                  : locked
                    ? 'border-border opacity-50'
                    : 'border-border hover:border-accent/40 hover:bg-surface-hover'
              } ${locked ? 'cursor-default' : ''}`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                  selected
                    ? 'bg-accent text-background'
                    : 'bg-surface-hover text-muted'
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="text-foreground block text-sm font-semibold">
                  {option.label}
                </span>
                <span className="text-muted block truncate text-xs">
                  {option.description}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
export type IdentityFieldErrors = Partial<Record<IdentityProfileField, string>>

/** Runs the shared profile schema and maps its issues onto field names. */
export function validateIdentityValues(
  values: IdentityValues
): IdentityFieldErrors {
  const parsed = IdentityProfileSchema.safeParse(values)
  if (parsed.success) return {}
  const errors: IdentityFieldErrors = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as IdentityProfileField
    if (field && !errors[field]) errors[field] = issue.message
  }
  return errors
}

const toLines = (value: string) =>
  value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

const baseInputClass =
  'w-full rounded-lg border bg-surface px-3.5 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors'

function FieldLabel({ def }: { def: IdentityFieldDefinition }) {
  return (
    <label
      htmlFor={def.name}
      className="text-foreground mb-1.5 block text-sm font-medium"
    >
      {def.label}
      {def.required && <span className="ml-1 text-rose-500">*</span>}
      {!def.required && def.hint && (
        <span className="text-muted ml-1.5 text-xs font-normal">
          {def.hint}
        </span>
      )}
    </label>
  )
}

function FieldFooter({
  def,
  error
}: {
  def: IdentityFieldDefinition
  error?: string
}) {
  if (error) return <p className="mt-1.5 text-xs text-red-500">{error}</p>
  // Optional fields show their hint beside the label instead.
  return def.hint && def.required ? (
    <p className="text-muted mt-1.5 text-xs">{def.hint}</p>
  ) : null
}

/**
 * Several short entries shown as chips. The value is the entries joined by
 * newlines, so it saves like any other text field. Entries that came from AI
 * suggestions are marked with a sparkle.
 */
function ChipsField({
  def,
  value,
  error,
  aiSuggested,
  onChange
}: {
  def: IdentityFieldDefinition
  value: string
  error?: string
  aiSuggested?: string
  onChange: (value: string) => void
}) {
  const items = toLines(value)
  const aiItems = new Set(toLines(aiSuggested ?? '').map(i => i.toLowerCase()))
  const [adding, setAdding] = useState(items.length === 0)
  const [draft, setDraft] = useState('')
  const box = useRef<HTMLDivElement>(null)

  // Entries arriving from outside (AI suggestions) collapse the input back to
  // "Add more", unless the user is typing in it.
  useEffect(() => {
    if (items.length > 0 && !box.current?.contains(document.activeElement)) {
      setAdding(false)
    }
  }, [items.length])

  const commit = () => {
    const entry = draft.trim()
    if (!entry) return
    if (!items.some(i => i.toLowerCase() === entry.toLowerCase())) {
      onChange([...items, entry].join('\n'))
    }
    setDraft('')
  }

  return (
    <div>
      <FieldLabel def={def} />
      <input type="hidden" name={def.name} value={items.join('\n')} />
      <div
        ref={box}
        className={`bg-surface scrollbar-visible flex h-32 flex-wrap content-start items-center gap-1.5 overflow-y-auto rounded-lg border px-2.5 py-2 ${
          error ? 'border-red-500/60 ring-1 ring-red-500/30' : 'border-border'
        }`}
      >
        {items.map(item => (
          <span
            key={item}
            className="border-accent/25 bg-accent/5 text-foreground inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 pr-1.5 pl-2.5 text-xs leading-snug"
          >
            {aiItems.has(item.toLowerCase()) && (
              <Sparkles
                className="text-accent h-3 w-3 shrink-0"
                aria-label="AI suggestion"
              />
            )}
            {item}
            <button
              type="button"
              aria-label={`Remove ${item}`}
              onClick={() => onChange(items.filter(i => i !== item).join('\n'))}
              className="text-muted rounded-full p-0.5 hover:text-red-500"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {adding ? (
          <input
            id={def.name}
            type="text"
            value={draft}
            autoFocus={items.length > 0}
            placeholder={items.length === 0 ? def.placeholder : 'Add another'}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Backspace' && !draft && items.length > 0) {
                onChange(items.slice(0, -1).join('\n'))
              }
            }}
            onBlur={() => {
              commit()
              if (items.length > 0) setAdding(false)
            }}
            className="text-foreground placeholder:text-muted min-w-32 flex-1 bg-transparent px-1 py-0.5 text-sm focus:outline-hidden"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-accent hover:bg-accent/10 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add more
          </button>
        )}
      </div>
      <FieldFooter def={def} error={error} />
    </div>
  )
}

/** One entry per line as a bullet list; stored newline-separated. */
function BulletListField({
  def,
  value,
  error,
  onChange
}: {
  def: IdentityFieldDefinition
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  const [rows, setRows] = useState<string[]>(() => {
    const lines = toLines(value)
    return lines.length > 0 ? lines : ['']
  })
  const lastEmitted = useRef(value)
  const refs = useRef<Array<HTMLTextAreaElement | null>>([])
  const focusRow = useRef<number | null>(null)

  // Follow outside changes (AI prefill, undo) but not our own edits.
  useEffect(() => {
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    const lines = toLines(value)
    setRows(lines.length > 0 ? lines : [''])
  }, [value])

  useEffect(() => {
    if (focusRow.current !== null) {
      refs.current[focusRow.current]?.focus()
      focusRow.current = null
    }
  })

  const update = (next: string[]) => {
    setRows(next)
    const joined = next
      .map(r => r.trim())
      .filter(Boolean)
      .join('\n')
    lastEmitted.current = joined
    onChange(joined)
  }

  return (
    <div>
      <FieldLabel def={def} />
      <input
        type="hidden"
        name={def.name}
        value={toLines(rows.join('\n')).join('\n')}
      />
      <ul
        className={`bg-surface scrollbar-visible h-32 space-y-0.5 overflow-y-auto rounded-lg border px-3.5 py-1.5 ${
          error ? 'border-red-500/60 ring-1 ring-red-500/30' : 'border-border'
        }`}
      >
        {rows.map((row, index) => (
          <li key={index} className="group flex items-start gap-2">
            <span className="text-muted mt-1 select-none" aria-hidden>
              •
            </span>
            {/* Grows with its text so long offerings wrap, not clip. */}
            <textarea
              rows={1}
              id={index === 0 ? def.name : undefined}
              ref={el => {
                refs.current[index] = el
              }}
              value={row}
              placeholder={index === 0 ? def.placeholder : 'Add another'}
              onChange={e =>
                update(rows.map((r, i) => (i === index ? e.target.value : r)))
              }
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  focusRow.current = index + 1
                  update([
                    ...rows.slice(0, index + 1),
                    '',
                    ...rows.slice(index + 1)
                  ])
                } else if (e.key === 'Backspace' && !row && rows.length > 1) {
                  e.preventDefault()
                  focusRow.current = Math.max(0, index - 1)
                  update(rows.filter((_, i) => i !== index))
                }
              }}
              className="text-foreground placeholder:text-muted field-sizing-content min-w-0 flex-1 resize-none bg-transparent py-0.5 text-sm leading-relaxed focus:outline-hidden"
            />
            {rows.length > 1 && (
              <button
                type="button"
                aria-label="Remove item"
                onClick={() => update(rows.filter((_, i) => i !== index))}
                className="text-muted mt-1 rounded p-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-red-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => {
              focusRow.current = rows.length
              update([...rows, ''])
            }}
            className="text-accent inline-flex items-center gap-1 py-0.5 text-xs font-medium hover:underline"
          >
            <Plus className="h-3 w-3" />
            Add item
          </button>
        </li>
      </ul>
      <FieldFooter def={def} error={error} />
    </div>
  )
}

function IdentityField({
  def,
  value,
  error,
  onChange
}: {
  def: IdentityFieldDefinition
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  const className = `${baseInputClass} ${
    error ? 'border-red-500/60 ring-1 ring-red-500/30' : 'border-border'
  }`

  return (
    <div>
      <FieldLabel def={def} />
      {def.type === 'textarea' ? (
        <textarea
          id={def.name}
          name={def.name}
          rows={3}
          value={value}
          required={def.required}
          placeholder={def.placeholder}
          onChange={e => onChange(e.target.value)}
          className={`${className} scrollbar-visible h-24 resize-none overflow-y-auto`}
        />
      ) : (
        <input
          id={def.name}
          name={def.name}
          type={def.type}
          value={value}
          required={def.required}
          placeholder={def.placeholder}
          onChange={e => onChange(e.target.value)}
          className={className}
        />
      )}
      <FieldFooter def={def} error={error} />
    </div>
  )
}

/** The Profile fields, laid out the same on the create and edit pages. */
export function IdentityFields({
  values,
  errors = {},
  aiSuggested,
  accountType,
  onAccountTypeChange,
  onChange
}: {
  values: IdentityValues
  errors?: IdentityFieldErrors
  accountType: AccountType
  /** Leave out to show the identity type read-only (edit page). */
  onAccountTypeChange?: (value: AccountType) => void
  /** Current AI suggestion per field, so matching chips get a sparkle. */
  aiSuggested?: Partial<Record<IdentityProfileField, string>>
  onChange: (field: IdentityProfileField, value: string) => void
}) {
  const field = (name: IdentityProfileField) => {
    let def = IDENTITY_FIELDS.find(f => f.name === name)!
    if (name === 'name') {
      def = {
        ...def,
        placeholder:
          accountType === 'company' ? 'e.g. Acme AI' : 'e.g. Aditya Sharma'
      }
    } else if (name === 'company') {
      def =
        accountType === 'company'
          ? {
              ...def,
              label: 'Parent Company / Brand',
              placeholder: 'e.g. Acme Corp'
            }
          : {
              ...def,
              label: 'Current Company',
              placeholder: 'e.g. The Developer Company'
            }
    }
    if (name === 'targetAudience') {
      return (
        <ChipsField
          key={name}
          def={def}
          value={values[name]}
          error={errors[name]}
          aiSuggested={aiSuggested?.[name]}
          onChange={value => onChange(name, value)}
        />
      )
    }
    if (name === 'offerings') {
      return (
        <BulletListField
          key={name}
          def={def}
          value={values[name]}
          error={errors[name]}
          onChange={value => onChange(name, value)}
        />
      )
    }
    return (
      <IdentityField
        key={name}
        def={def}
        value={values[name]}
        error={errors[name]}
        onChange={value => onChange(name, value)}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-6">
      <div className="sm:col-span-6">
        <AccountTypePicker value={accountType} onChange={onAccountTypeChange} />
      </div>

      <div className="sm:col-span-3 lg:col-span-2">{field('name')}</div>
      <div className="sm:col-span-3 lg:col-span-2">{field('company')}</div>
      <div className="sm:col-span-6 lg:col-span-2">{field('industry')}</div>

      <div className="sm:col-span-6">{field('description')}</div>

      <div className="sm:col-span-6 lg:col-span-3">
        {field('targetAudience')}
      </div>
      <div className="sm:col-span-6 lg:col-span-3">{field('offerings')}</div>

      <div className="sm:col-span-3">{field('linkedinUrl')}</div>
      <div className="sm:col-span-3">{field('websiteUrl')}</div>
    </div>
  )
}
