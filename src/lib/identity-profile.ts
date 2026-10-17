import { z } from 'zod'

/**
 * The Profile fields shared by the create form, the edit form and the AI setup
 * apply step, so all three validate the same way.
 */

export const URL_MESSAGE = 'URLs must start with http:// or https://'

/** The message for an invalid optional URL, or undefined when it is fine. */
export function optionalUrlError(value: string): string | undefined {
  const v = value.trim()
  return !v || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v) ? undefined : URL_MESSAGE
}

const optionalHttpUrl = z
  .string()
  .trim()
  .optional()
  .refine(value => !optionalUrlError(value ?? ''), URL_MESSAGE)

/** Longest each text field may be; the inputs stop typing at the same limit. */
export const PROFILE_MAX_LENGTH = {
  name: 200,
  company: 200,
  description: 5000,
  targetAudience: 2000,
  offerings: 3000,
  industry: 200
} as const

const tooLong = (label: string, max: number) =>
  `${label} must be ${max.toLocaleString('en-US')} characters or fewer`

export const IdentityProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Display name is required')
    .max(PROFILE_MAX_LENGTH.name, tooLong('Display name', PROFILE_MAX_LENGTH.name)),
  company: z
    .string()
    .trim()
    .max(PROFILE_MAX_LENGTH.company, tooLong('Company name', PROFILE_MAX_LENGTH.company))
    .optional(),
  description: z
    .string()
    .trim()
    .min(1, 'Description is required')
    .max(PROFILE_MAX_LENGTH.description, tooLong('Description', PROFILE_MAX_LENGTH.description)),
  targetAudience: z
    .string()
    .trim()
    .min(1, 'Target audience is required')
    .max(
      PROFILE_MAX_LENGTH.targetAudience,
      tooLong('Target audience', PROFILE_MAX_LENGTH.targetAudience)
    ),
  offerings: z
    .string()
    .trim()
    .min(1, 'Offerings are required')
    .max(PROFILE_MAX_LENGTH.offerings, tooLong('Offerings', PROFILE_MAX_LENGTH.offerings)),
  industry: z
    .string()
    .trim()
    .min(1, 'Industry is required')
    .max(PROFILE_MAX_LENGTH.industry, tooLong('Industry', PROFILE_MAX_LENGTH.industry)),
  linkedinUrl: optionalHttpUrl,
  websiteUrl: optionalHttpUrl
})

export type IdentityProfile = z.infer<typeof IdentityProfileSchema>

export type IdentityProfileField = keyof IdentityProfile

export type IdentityFieldDefinition = {
  name: IdentityProfileField
  label: string
  type: 'text' | 'url' | 'textarea'
  placeholder: string
  hint?: string
  required?: boolean
}

export const IDENTITY_FIELDS: IdentityFieldDefinition[] = [
  {
    name: 'name',
    label: 'Display Name',
    type: 'text',
    placeholder: 'Enter your display name',
    required: true
  },
  {
    name: 'company',
    label: 'Company Name',
    type: 'text',
    placeholder: 'e.g. Acme AI',
    hint: '(optional)'
  },
  {
    name: 'description',
    label: 'Description',
    type: 'textarea',
    placeholder: 'e.g. Founder of a B2B SaaS startup helping sales teams automate outreach. 10+ years in product and growth.',
    required: true
  },
  {
    name: 'targetAudience',
    label: 'Target Audience',
    type: 'textarea',
    placeholder:
      'e.g. Heads of Sales and RevOps leaders at B2B SaaS companies with 50-500 employees',
    required: true
  },
  {
    name: 'offerings',
    label: 'Offerings',
    type: 'textarea',
    placeholder:
      'e.g. AI engineering consulting, a RAG evaluation toolkit, a weekly newsletter',
    required: true
  },
  {
    name: 'industry',
    label: 'Industry',
    type: 'text',
    placeholder: 'e.g. B2B SaaS, Healthcare, Fintech',
    required: true
  },
  {
    name: 'linkedinUrl',
    label: 'LinkedIn Profile / Page URL',
    hint: '(optional)',
    type: 'url',
    placeholder: 'https://www.linkedin.com/in/your-name'
  },
  {
    name: 'websiteUrl',
    label: 'Website URL',
    hint: '(optional)',
    type: 'url',
    placeholder: 'https://example.com'
  }
]

export const EMPTY_PROFILE: Record<IdentityProfileField, string> = {
  name: '',
  company: '',
  description: '',
  targetAudience: '',
  offerings: '',
  industry: '',
  linkedinUrl: '',
  websiteUrl: ''
}

/**
 * The profile keeps one free-text audience and one free-text offerings field,
 * stored as the account's primary (oldest) audience and offering rows. Rows
 * beyond the first, from identities created before this form, are left alone.
 */
export function profileFromRecords(
  account: {
    name: string
    company?: string | null
    bio?: string | null
    industry?: string | null
    linkedinUrl?: string | null
    websiteUrl?: string | null
  },
  primaryOffering?: { name: string; description?: string | null } | null,
  primaryAudience?: { name: string } | null
): Record<IdentityProfileField, string> {
  return {
    name: account.name || '',
    company: account.company || '',
    description: account.bio || '',
    targetAudience: primaryAudience?.name || '',
    offerings: primaryOffering?.description || primaryOffering?.name || '',
    industry: account.industry || '',
    linkedinUrl: account.linkedinUrl || '',
    websiteUrl: account.websiteUrl || ''
  }
}

/** The offering row's name is the first line of the free-text offerings. */
export function offeringNameFromText(offerings: string): string {
  const firstLine = offerings.split('\n')[0]?.trim() ?? ''
  return firstLine.slice(0, 80) || 'Offerings'
}

/** The accounts table requires a headline; build one from the profile. */
export function deriveHeadline(profile: {
  name: string
  company?: string
  industry?: string
}): string {
  return (
    [profile.company, profile.industry].filter(Boolean).join(' · ') ||
    profile.name
  )
}
