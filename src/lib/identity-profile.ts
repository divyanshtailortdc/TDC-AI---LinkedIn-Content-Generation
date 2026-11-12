import { z } from 'zod'

/**
 * The Profile fields shared by the create form, the edit form and the AI setup
 * apply step, so all three validate the same way.
 */

/**
 * Who is posting: a person as themselves, or a brand (a business, product or
 * page). How the posts sound is a separate choice made per platform
 * (professional, casual or fun; src/lib/formats/styles.ts), so a dancer and a
 * café can both be fun, and a founder can be professional on LinkedIn and
 * casual on Instagram.
 */
export const ACCOUNT_TYPES = ['personal', 'company'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

/**
 * A stored or submitted type; anything else is a person, as before. (An
 * identity saved as a "creator" while that was a type reads as a person.)
 */
export function parseAccountType(value: unknown): AccountType {
  return value === 'company' ? 'company' : 'personal'
}

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

/** Longest each text field may be; the form counts against it and the schema enforces it. */
export const PROFILE_MAX_LENGTH = {
  name: 200,
  company: 200,
  description: 5000,
  targetAudience: 2000,
  offerings: 3000,
  industry: 200
} as const

/** The message for a text over its limit, with the field named. */
export const tooLong = (label: string, max: number) =>
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
    .min(1, 'Add a short description')
    .max(PROFILE_MAX_LENGTH.description, tooLong('Description', PROFILE_MAX_LENGTH.description)),
  targetAudience: z
    .string()
    .trim()
    .min(1, "Say who it's for")
    .max(
      PROFILE_MAX_LENGTH.targetAudience,
      tooLong('Target audience', PROFILE_MAX_LENGTH.targetAudience)
    ),
  // Optional: plenty of people post without selling anything.
  offerings: z
    .string()
    .trim()
    .max(PROFILE_MAX_LENGTH.offerings, tooLong('What you promote', PROFILE_MAX_LENGTH.offerings))
    .optional()
    .default(''),
  // Stored as the account's industry; asked as what they post about.
  industry: z
    .string()
    .trim()
    .min(1, 'Say what you post about')
    .max(PROFILE_MAX_LENGTH.industry, tooLong('What you post about', PROFILE_MAX_LENGTH.industry)),
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

/**
 * Worded for anyone who posts, from a founder to a dancer to a café. The
 * columns keep their original names: industry holds what they post about,
 * linkedinUrl their main profile on any platform.
 */
export const IDENTITY_FIELDS: IdentityFieldDefinition[] = [
  {
    name: 'name',
    label: 'Name',
    type: 'text',
    placeholder: 'e.g. Priya Rao',
    required: true
  },
  {
    name: 'company',
    label: 'Where You Work',
    type: 'text',
    placeholder: 'e.g. Acme Corp',
    hint: '(optional)'
  },
  {
    name: 'description',
    label: 'About',
    type: 'textarea',
    placeholder:
      'e.g. Dance teacher from Pune. I post short tutorials and rehearsal bloopers with my students.',
    required: true
  },
  {
    name: 'targetAudience',
    label: "Who It's For",
    type: 'textarea',
    placeholder:
      'e.g. Teens learning to dance at home; parents of my students',
    required: true
  },
  {
    name: 'offerings',
    label: 'What You Promote',
    type: 'textarea',
    placeholder:
      'e.g. Weekend dance classes, a course, your product or services. Leave empty if nothing.',
    hint: '(optional)'
  },
  {
    name: 'industry',
    label: 'What You Post About',
    type: 'text',
    placeholder: 'e.g. Bollywood dance, B2B sales, home baking',
    required: true
  },
  {
    name: 'linkedinUrl',
    label: 'Main Profile Link',
    hint: '(optional)',
    type: 'url',
    placeholder: 'https://www.instagram.com/your-handle'
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
