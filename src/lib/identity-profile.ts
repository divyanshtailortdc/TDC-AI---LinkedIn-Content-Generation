import { z } from 'zod'

/**
 * The Profile fields shared by the create form, the edit form and the AI setup
 * apply step, so all three validate the same way.
 */

const optionalHttpUrl = z
  .string()
  .trim()
  .optional()
  .refine(
    value => !value || /^https?:\/\/[^\s]+\.[^\s]+/i.test(value),
    'URLs must start with http:// or https://'
  )

export const IdentityProfileSchema = z.object({
  name: z.string().trim().min(1, 'Display name is required').max(200),
  company: z.string().trim().max(200).optional(),
  description: z.string().trim().min(1, 'Description is required').max(5000),
  targetAudience: z
    .string()
    .trim()
    .min(1, 'Target audience is required')
    .max(2000),
  offerings: z.string().trim().min(1, 'Offerings are required').max(3000),
  industry: z.string().trim().min(1, 'Industry is required').max(200),
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
    placeholder: 'e.g. Aditya Sharma',
    required: true
  },
  {
    name: 'company',
    label: 'Company Name',
    type: 'text',
    placeholder: 'e.g. Acme AI',
    hint: 'Optional for personal brands.'
  },
  {
    name: 'description',
    label: 'Description',
    type: 'textarea',
    placeholder: 'Who you are and what you do, in a few sentences.',
    required: true
  },
  {
    name: 'targetAudience',
    label: 'Target Audience',
    type: 'textarea',
    placeholder:
      'e.g. Senior Product Managers and VPs of Product at B2B SaaS companies',
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
    type: 'url',
    placeholder: 'https://www.linkedin.com/in/your-name'
  },
  {
    name: 'websiteUrl',
    label: 'Website URL',
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
