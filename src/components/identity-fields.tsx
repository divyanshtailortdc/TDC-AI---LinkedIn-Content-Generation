'use client'

import {
  IDENTITY_FIELDS,
  IdentityProfileSchema,
  type IdentityFieldDefinition,
  type IdentityProfileField
} from '@/lib/identity-profile'

export type IdentityValues = Record<IdentityProfileField, string>
export type IdentityFieldErrors = Partial<Record<IdentityProfileField, string>>

/** Runs the shared profile schema and maps its issues onto field names. */
export function validateIdentityValues(values: IdentityValues): IdentityFieldErrors {
  const parsed = IdentityProfileSchema.safeParse(values)
  if (parsed.success) return {}
  const errors: IdentityFieldErrors = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as IdentityProfileField
    if (field && !errors[field]) errors[field] = issue.message
  }
  return errors
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
  const className = `w-full rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors ${
    error ? 'border-red-500/60 ring-1 ring-red-500/30' : 'border-border'
  }`

  return (
    <div>
      <label htmlFor={def.name} className="text-foreground mb-1.5 block text-sm font-medium">
        {def.label}
        {def.required && <span className="ml-1 text-rose-500">*</span>}
      </label>
      {def.type === 'textarea' ? (
        <textarea
          id={def.name}
          name={def.name}
          rows={3}
          value={value}
          required={def.required}
          placeholder={def.placeholder}
          onChange={e => onChange(e.target.value)}
          className={`${className} resize-y`}
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
      {error ? (
        <p className="mt-1.5 text-xs text-red-500">{error}</p>
      ) : (
        def.hint && <p className="text-muted mt-1.5 text-xs">{def.hint}</p>
      )}
    </div>
  )
}

/** The Profile fields, laid out the same on the create and edit pages. */
export function IdentityFields({
  values,
  errors = {},
  onChange
}: {
  values: IdentityValues
  errors?: IdentityFieldErrors
  onChange: (field: IdentityProfileField, value: string) => void
}) {
  const field = (name: IdentityProfileField) => {
    const def = IDENTITY_FIELDS.find(f => f.name === name)!
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
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {field('name')}
        {field('company')}
      </div>
      {field('description')}
      {field('targetAudience')}
      {field('offerings')}
      {field('industry')}

      <div className="border-border space-y-5 border-t pt-6">
        <h2 className="text-foreground text-sm font-semibold">
          Online Presence <span className="text-muted font-normal">(Optional)</span>
        </h2>
        {field('linkedinUrl')}
        {field('websiteUrl')}
      </div>
    </div>
  )
}
