'use client'

import {
  IDENTITY_FIELDS,
  IdentityProfileSchema,
  PROFILE_MAX_LENGTH,
  type IdentityFieldDefinition,
  type IdentityProfileField
} from '@/lib/identity-profile'
import { Building2, Globe, Link2, Sparkles, User } from 'lucide-react'
import type { ReactNode } from 'react'

export type IdentityValues = Record<IdentityProfileField, string>
export type AccountType = 'personal' | 'company'

/** The schema's limit for a text field; URL fields have none. */
const maxLengthOf = (name: IdentityProfileField): number | undefined =>
  name in PROFILE_MAX_LENGTH
    ? PROFILE_MAX_LENGTH[name as keyof typeof PROFILE_MAX_LENGTH]
    : undefined

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
 * One titled group of fields. The Profile step is three of these: the identity
 * type, the basic information and the online presence.
 */
function SectionCard({
  title,
  description,
  required,
  aside,
  children
}: {
  title: string
  description?: string
  required?: boolean
  /** Sits at the right end of the heading row. */
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-border bg-surface-hover/30 rounded-xl border p-5">
      <header className="border-border mb-4 flex items-start justify-between gap-3 border-b pb-3">
        <div className="min-w-0">
          <h3 className="text-foreground text-xs font-semibold tracking-wider uppercase">
            {title}
            {required && <span className="ml-1 text-rose-600 dark:text-rose-400">*</span>}
          </h3>
          {description && (
            <p className="text-muted mt-1 text-xs">{description}</p>
          )}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

/**
 * Whether the AI writes as a person or as a brand. Chosen when the identity is
 * created; the edit page shows it locked, as it always has.
 */
function AccountTypePicker({
  value,
  onChange,
  readOnly = false
}: {
  value: AccountType
  /** Leave out to show the choice read-only. */
  onChange?: (value: AccountType) => void
  /** Viewing a saved profile: locked until the person clicks Edit. */
  readOnly?: boolean
}) {
  const locked = !onChange || readOnly
  return (
    <SectionCard title="What kind of identity is this?" required>
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
              className={`flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors ${
                selected
                  ? 'border-accent bg-accent/5 ring-accent/20 ring-1'
                  : locked
                    ? 'border-border opacity-50'
                    : 'border-border bg-surface hover:border-accent/40 hover:bg-surface-hover'
              } ${locked ? 'cursor-default' : ''}`}
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  selected ? 'border-accent' : 'border-muted'
                }`}
              >
                {selected && (
                  <span className="bg-accent h-2 w-2 rounded-full" />
                )}
              </span>
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
    </SectionCard>
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

const baseInputClass =
  'w-full rounded-lg border bg-surface px-3.5 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors'

function FieldLabel({
  def,
  rightHint,
  aiFilled = false
}: {
  def: IdentityFieldDefinition
  /** Short guidance at the far end of the label row. */
  rightHint?: string
  /** The value is still the one the AI assistant put there. */
  aiFilled?: boolean
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label
        htmlFor={def.name}
        className="text-foreground block text-sm font-medium"
      >
        {def.label}
        {def.required && <span className="ml-1 text-rose-600 dark:text-rose-400">*</span>}
        {!def.required && def.hint && (
          <span className="text-muted ml-1.5 text-xs font-normal">
            {def.hint}
          </span>
        )}
        {aiFilled && (
          <span
            title="Filled from an AI suggestion. Edit it freely."
            className="bg-accent/10 text-accent ml-2 inline-flex items-center gap-0.5 rounded-full px-1.5 py-px align-middle text-[10px] font-semibold"
          >
            <Sparkles aria-hidden className="h-2.5 w-2.5" />
            <span aria-hidden>AI</span>
            <span className="sr-only">(filled from an AI suggestion)</span>
          </span>
        )}
      </label>
      {rightHint && (
        <span className="text-muted shrink-0 text-xs">{rightHint}</span>
      )}
    </div>
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

function IdentityField({
  def,
  value,
  error,
  rightHint,
  icon,
  textareaClass = 'h-24',
  readOnly = false,
  aiFilled = false,
  onChange
}: {
  def: IdentityFieldDefinition
  value: string
  error?: string
  rightHint?: string
  aiFilled?: boolean
  /** Shown inside the input, before the text. */
  icon?: ReactNode
  /** Starting height of the box when the field is a textarea. */
  textareaClass?: string
  /** Show the saved text, not an input. */
  readOnly?: boolean
  onChange: (value: string) => void
}) {
  if (readOnly) {
    // Plain text: no box, no border, so nothing looks like something to type
    // into. Small muted label over the saved value, like a details page.
    return (
      <div>
        <div className="text-muted mb-0.5 text-[11px] font-medium tracking-wider uppercase">
          {def.label}
        </div>
        <div
          id={def.name}
          role="textbox"
          aria-readonly="true"
          aria-multiline={def.type === 'textarea'}
          title={def.type === 'url' ? value : undefined}
          className={`text-foreground scrollbar-visible max-h-40 text-sm leading-relaxed ${
            // A link stays on one line, with the whole address on hover.
            def.type === 'url'
              ? 'truncate'
              : 'overflow-y-auto wrap-break-word whitespace-pre-wrap'
          }`}
        >
          {value.trim() ? (
            value
          ) : (
            <span className="text-muted italic">Not set</span>
          )}
        </div>
      </div>
    )
  }

  const className = `${baseInputClass} ${
    error
      ? 'border-red-500/60 ring-1 ring-red-500/30'
      : aiFilled
        ? 'border-accent/40'
        : 'border-border'
  }`

  return (
    <div>
      <FieldLabel def={def} rightHint={rightHint} aiFilled={aiFilled} />
      {def.type === 'textarea' ? (
        <textarea
          id={def.name}
          name={def.name}
          rows={3}
          value={value}
          maxLength={maxLengthOf(def.name)}
          required={def.required}
          placeholder={def.placeholder}
          onChange={e => onChange(e.target.value)}
          className={`${className} scrollbar-visible ${textareaClass} resize-y overflow-y-auto`}
        />
      ) : (
        <div className="relative">
          {icon && (
            <span className="text-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
              {icon}
            </span>
          )}
          <input
            id={def.name}
            name={def.name}
            type={def.type}
            value={value}
            maxLength={maxLengthOf(def.name)}
            required={def.required}
            placeholder={def.placeholder}
            onChange={e => onChange(e.target.value)}
            className={`${className} ${icon ? 'pl-9' : ''}`}
          />
        </div>
      )}
      <FieldFooter def={def} error={error} />
    </div>
  )
}

/** The Profile fields, laid out the same on the create and edit pages. */
export function IdentityFields({
  values,
  errors = {},
  accountType,
  onAccountTypeChange,
  readOnly = false,
  aiFilled,
  onChange
}: {
  values: IdentityValues
  errors?: IdentityFieldErrors
  /** Fields still holding an AI suggestion, marked until the user edits them. */
  aiFilled?: ReadonlySet<string>
  accountType: AccountType
  /** Leave out to show the identity type read-only (edit page). */
  onAccountTypeChange?: (value: AccountType) => void
  /** A saved profile being viewed: every field is plain text until edited. */
  readOnly?: boolean
  onChange: (field: IdentityProfileField, value: string) => void
}) {
  const field = (
    name: IdentityProfileField,
    extras: {
      rightHint?: string
      textareaClass?: string
    } = {}
  ) => {
    let def = IDENTITY_FIELDS.find(f => f.name === name)!
    if (name === 'name') {
      def = {
        ...def,
        placeholder:
          accountType === 'company' ? 'e.g. Acme AI' : 'Enter your display name'
      }
    } else if (name === 'industry') {
      def = { ...def, type: 'textarea' }
    } else if (name === 'description') {
      def = {
        ...def,
        label: 'Short Description',
        placeholder:
          accountType === 'company'
            ? 'e.g. Acme AI builds workflow automation software that helps sales teams book more meetings.'
            : def.placeholder
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
              placeholder: 'e.g. Acme Corp'
            }
    }
    return (
      <IdentityField
        key={name}
        def={def}
        value={values[name]}
        error={errors[name]}
        rightHint={extras.rightHint}
        textareaClass={extras.textareaClass}
        readOnly={readOnly}
        aiFilled={aiFilled?.has(name)}
        onChange={value => onChange(name, value)}
      />
    )
  }

  return (
    <div className="space-y-5">
      <AccountTypePicker
        value={accountType}
        onChange={onAccountTypeChange}
        readOnly={readOnly}
      />

      <SectionCard title="Basic information">
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          {field('name')}
          {field('company')}
          <div className="sm:col-span-2">
            {field('industry', { textareaClass: 'h-20' })}
          </div>
          <div className="sm:col-span-2">
            {field('description', {
              textareaClass: 'h-28'
            })}
          </div>
          <div className="sm:col-span-2">
            {field('targetAudience', { textareaClass: 'h-28' })}
          </div>
          <div className="sm:col-span-2">
            {field('offerings', {
              textareaClass: 'h-28'
            })}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Online presence">
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <IdentityField
            def={IDENTITY_FIELDS.find(f => f.name === 'linkedinUrl')!}
            value={values.linkedinUrl}
            error={errors.linkedinUrl}
            icon={<Link2 className="h-4 w-4" />}
            readOnly={readOnly}
            aiFilled={aiFilled?.has('linkedinUrl')}
            onChange={value => onChange('linkedinUrl', value)}
          />
          <IdentityField
            def={IDENTITY_FIELDS.find(f => f.name === 'websiteUrl')!}
            value={values.websiteUrl}
            error={errors.websiteUrl}
            icon={<Globe className="h-4 w-4" />}
            readOnly={readOnly}
            aiFilled={aiFilled?.has('websiteUrl')}
            onChange={value => onChange('websiteUrl', value)}
          />
        </div>
      </SectionCard>
    </div>
  )
}
