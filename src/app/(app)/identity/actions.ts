'use server'

import { db } from '@/db'
import { getIdentity, IDENTITY_PATH } from '@/lib/identity'
import { deriveHeadline, IdentityProfileSchema } from '@/lib/identity-profile'
import { insertIdentity, updateIdentity } from '@/lib/identity-write'
import { findOwnedAccount } from '@/lib/ownership'
import { requireUser } from '@/lib/session'
import { AccountIdSchema } from '@/lib/setup-payloads'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

function extractAndSanitizeHandle(
  rawInput: string | null | undefined,
  nameFallback: string = ''
): string {
  let cleaned = (rawInput || '').trim()

  // Extract handle if user pasted full LinkedIn URL (e.g. linkedin.com/in/aditya-kumar-376474235 or linkedin.com/company/acme)
  const linkedinMatch = cleaned.match(
    /(?:linkedin\.com\/(?:in|company)\/)([^/?#]+)/i
  )
  if (linkedinMatch && linkedinMatch[1]) {
    cleaned = linkedinMatch[1]
  }

  // Remove URL scheme or slashes if user typed https://...
  cleaned = cleaned.replace(/^https?:\/\//i, '').replace(/^www\./i, '')

  // Fallback to name if empty
  if (!cleaned) {
    cleaned = nameFallback.trim()
  }

  // Convert to clean URL slug
  const slug = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'identity'
}

function profileFromFormData(formData: FormData) {
  const field = (key: string) => (formData.get(key) as string) || ''
  return {
    name: field('name'),
    company: field('company') || undefined,
    description: field('description'),
    targetAudience: field('targetAudience'),
    offerings: field('offerings'),
    industry: field('industry'),
    linkedinUrl: field('linkedinUrl') || undefined,
    websiteUrl: field('websiteUrl') || undefined
  }
}

/** Postgres unique_violation: here, the user already owns an identity. */
const isUniqueViolation = (err: any) =>
  err?.code === '23505' || err?.cause?.code === '23505'

/**
 * Creates the signed-in user's identity. Each user has one: when it already
 * exists (a second click, a retried request, another tab), nothing is
 * inserted and the user is sent to it. UNIQUE(accounts.user_id) settles a
 * race between two creates.
 */
export async function createAccount(formData: FormData) {
  const user = await requireUser()
  if (await getIdentity()) return { redirectTo: IDENTITY_PATH }

  const parsed = IdentityProfileSchema.safeParse(profileFromFormData(formData))
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(i => i.message).join(', '))
  }
  const data = parsed.data
  const accountType =
    formData.get('accountType') === 'company'
      ? ('company' as const)
      : ('personal' as const)

  try {
    // The account and its offering and audience are written together.
    await insertIdentity(
      db,
      {
        userId: user.id,
        name: data.name,
        accountType,
        handle: extractAndSanitizeHandle(data.linkedinUrl, data.name),
        headline: deriveHeadline(data),
        bio: data.description,
        company: data.company || null,
        industry: data.industry,
        linkedinUrl: data.linkedinUrl || null,
        websiteUrl: data.websiteUrl || null
      },
      data
    )
  } catch (err) {
    if (isUniqueViolation(err)) return { redirectTo: IDENTITY_PATH }
    throw err
  }

  // The sidebar and every identity-scoped page change once it exists.
  revalidatePath('/', 'layout')
  // The create page sets this when AI setup suggestions are waiting to be
  // reviewed. They are reviewed on the Profile step, where the AI assistant
  // lives and opens the review window, so that is where those people land.
  // Returned rather than thrown with `redirect()`: the create page calls this
  // from an event handler, where the redirect error surfaced as a failure.
  return {
    redirectTo:
      formData.get('claimAiDraft') === '1'
        ? `${IDENTITY_PATH}?aiSetup=claim`
        : `${IDENTITY_PATH}/voice`
  }
}

const updateAccountSchema = IdentityProfileSchema.extend({
  id: AccountIdSchema,
  /** Person or Company / Product; left out keeps the saved type. */
  accountType: z.enum(['personal', 'company']).optional()
})

export type UpdateAccountInput = z.input<typeof updateAccountSchema>

export async function updateAccountAction(input: UpdateAccountInput) {
  const user = await requireUser()
  try {
    const parsed = updateAccountSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues.map(i => i.message).join('. ')
      }
    }
    const validated = parsed.data

    const existing = await findOwnedAccount(db, user.id, validated.id)
    if (!existing) {
      return { success: false, error: 'Identity not found' }
    }

    // The handle only follows the LinkedIn URL; renaming keeps the old handle.
    let handle = existing.handle
    if (
      validated.linkedinUrl &&
      validated.linkedinUrl !== (existing.linkedinUrl || '')
    ) {
      handle = extractAndSanitizeHandle(validated.linkedinUrl, validated.name)
    }

    await updateIdentity(
      db,
      validated.id,
      {
        name: validated.name,
        ...(validated.accountType
          ? { accountType: validated.accountType }
          : {}),
        handle,
        // Keep a headline someone wrote; only fill it when there is none.
        headline: existing.headline?.trim() || deriveHeadline(validated),
        bio: validated.description,
        company: validated.company || null,
        industry: validated.industry,
        linkedinUrl: validated.linkedinUrl || null,
        websiteUrl: validated.websiteUrl || null,
        updatedAt: new Date()
      },
      validated
    )

    revalidatePath('/')
    revalidatePath(IDENTITY_PATH, 'layout')

    return { success: true }
  } catch (error: any) {
    console.error('Error updating account identity:', error)
    return {
      success: false,
      error: error?.message || 'Failed to update identity'
    }
  }
}
