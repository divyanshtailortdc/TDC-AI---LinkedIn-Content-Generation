'use client'

import {
  IDENTITY_FIELDS,
  IdentityProfileSchema,
  type IdentityFieldDefinition,
  type IdentityProfileField
} from '@/lib/identity-profile'
import { Building2, Lock, User } from 'lucide-react'
import type { ReactNode } from 'react'

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
            {required && <span className="ml-1 text-rose-500">*</span>}
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
  onChange
}: {
  value: AccountType
  /** Leave out to show the choice read-only. */
  onChange?: (value: AccountType) => void
}) {
  const locked = !onChange
  return (
    <SectionCard
      title="What kind of identity is this?"
      required
      aside={
        locked && (
          <span className="text-muted inline-flex shrink-0 items-center gap-1 text-xs">
            <Lock className="h-3 w-3" />
            Set when the identity was created
          </span>
        )
      }
    >
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
  rightHint
}: {
  def: IdentityFieldDefinition
  /** Short guidance at the far end of the label row. */
  rightHint?: string
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label
        htmlFor={def.name}
        className="text-foreground block text-sm font-medium"
      >
        {def.label}
        {def.required && <span className="ml-1 text-rose-500">*</span>}
        {!def.required && def.hint && (
          <span className="text-muted ml-1.5 text-xs font-normal">
            {def.hint}
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
  onChange
}: {
  def: IdentityFieldDefinition
  value: string
  error?: string
  rightHint?: string
  /** Shown inside the input, before the text. */
  icon?: ReactNode
  /** Starting height of the box when the field is a textarea. */
  textareaClass?: string
  onChange: (value: string) => void
}) {
  const className = `${baseInputClass} ${
    error ? 'border-red-500/60 ring-1 ring-red-500/30' : 'border-border'
  }`

  return (
    <div>
      <FieldLabel def={def} rightHint={rightHint} />
      {def.type === 'textarea' ? (
        <textarea
          id={def.name}
          name={def.name}
          rows={3}
          value={value}
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
  onChange
}: {
  values: IdentityValues
  errors?: IdentityFieldErrors
  accountType: AccountType
  /** Leave out to show the identity type read-only (edit page). */
  onAccountTypeChange?: (value: AccountType) => void
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
        onChange={value => onChange(name, value)}
      />
    )
  }

  return (
    <div className="space-y-5">
      <AccountTypePicker value={accountType} onChange={onAccountTypeChange} />

      <SectionCard
        title="Basic information"
        description={
          accountType === 'company'
            ? 'Core attributes the model references for your brand'
            : 'Core attributes the model references for personal branding'
        }
      >
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          {field('name')}
          {field('company')}
          <div className="sm:col-span-2">
            {field('industry', { textareaClass: 'h-20' })}
          </div>
          <div className="sm:col-span-2">
            {field('description', {
              rightHint: '2-3 sentences recommended',
              textareaClass: 'h-28'
            })}
          </div>
          <div className="sm:col-span-2">
            {field('targetAudience', { textareaClass: 'h-28' })}
          </div>
          <div className="sm:col-span-2">
            {field('offerings', {
              rightHint: 'Key expertise, products or services',
              textareaClass: 'h-28'
            })}
          </div>
        </div>
      </SectionCard>

      {/* The two URLs are entered in the AI assistant's Online presence
          card; the form still submits them. */}
      <input type="hidden" name="linkedinUrl" value={values.linkedinUrl} />
      <input type="hidden" name="websiteUrl" value={values.websiteUrl} />
    </div>
  )
}
