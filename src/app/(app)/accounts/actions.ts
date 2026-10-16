'use server'

import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { writeActiveAccountCookie } from '@/lib/active-account'
import {
  deriveHeadline,
  IdentityProfileSchema
} from '@/lib/identity-profile'
import { insertIdentity, updateIdentity } from '@/lib/identity-write'
import { and, eq, ne } from 'drizzle-orm'
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

/** Appends -2, -3, ... until the handle is free (ignoring `exceptId`). */
async function findAvailableHandle(baseHandle: string, exceptId?: string) {
  let candidate = baseHandle
  let counter = 1
  while (true) {
    const existing = await db.query.accountsTable.findFirst({
      where: exceptId
        ? and(
            eq(accountsTable.handle, candidate),
            ne(accountsTable.id, exceptId)
          )
        : eq(accountsTable.handle, candidate)
    })
    if (!existing) return candidate
    counter++
    candidate = `${baseHandle}-${counter}`
  }
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

export async function createAccount(formData: FormData) {
  const parsed = IdentityProfileSchema.safeParse(profileFromFormData(formData))
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(i => i.message).join(', '))
  }
  const data = parsed.data
  const accountType =
    formData.get('accountType') === 'company'
      ? ('company' as const)
      : ('personal' as const)

  // The handle is derived from the LinkedIn URL (falling back to the name) and
  // deduplicated against existing accounts to prevent a unique constraint crash.
  const candidateHandle = await findAvailableHandle(
    extractAndSanitizeHandle(data.linkedinUrl, data.name)
  )

  const accountValues = (handle: string) => ({
    name: data.name,
    accountType,
    handle,
    headline: deriveHeadline(data),
    bio: data.description,
    company: data.company || null,
    industry: data.industry,
    linkedinUrl: data.linkedinUrl || null,
    websiteUrl: data.websiteUrl || null
  })

  // The account and its offering and audience are written together. A
  // concurrent create can take the handle first; retry once with a unique suffix.
  let account: typeof accountsTable.$inferSelect
  try {
    account = await insertIdentity(db, accountValues(candidateHandle), data)
  } catch (err: any) {
    if (err?.code === '23505' || err?.cause?.code === '23505') {
      const fallbackHandle = `${candidateHandle}-${Date.now().toString(36)}`
      account = await insertIdentity(db, accountValues(fallbackHandle), data)
    } else {
      throw err
    }
  }

  // The identity just created is the one being set up, so it becomes active
  // straight away. Revalidating the root layout re-renders the sidebar (its
  // switcher list and active identity) along with every account-scoped page.
  await writeActiveAccountCookie(account.id)
  revalidatePath('/', 'layout')
  revalidatePath('/')
  revalidatePath('/accounts')
  // The create page sets this when AI setup suggestions are waiting to be
  // reviewed. They are reviewed on the Profile step, where the AI assistant
  // lives and opens the review window, so that is where those people land.
  // Returned rather than thrown with `redirect()`: the create page calls this
  // from an event handler, where the redirect error surfaced as a failure.
  return {
    redirectTo:
      formData.get('claimAiDraft') === '1'
        ? `/accounts/${account.id}?aiSetup=claim`
        : `/accounts/${account.id}/voice`
  }
}

const updateAccountSchema = IdentityProfileSchema.extend({
  id: z.string().uuid('Invalid account identifier'),
  /** Person or Company / Product; left out keeps the saved type. */
  accountType: z.enum(['personal', 'company']).optional()
})

export type UpdateAccountInput = z.input<typeof updateAccountSchema>

export async function updateAccountAction(input: UpdateAccountInput) {
  try {
    const parsed = updateAccountSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues.map(i => i.message).join('. ')
      }
    }
    const validated = parsed.data

    const existing = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, validated.id)
    })
    if (!existing) {
      return { success: false, error: 'Account identity not found' }
    }

    // The handle only follows the LinkedIn URL; renaming keeps the old handle.
    let handle = existing.handle
    if (
      validated.linkedinUrl &&
      validated.linkedinUrl !== (existing.linkedinUrl || '')
    ) {
      handle = await findAvailableHandle(
        extractAndSanitizeHandle(validated.linkedinUrl, validated.name),
        validated.id
      )
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
    revalidatePath('/accounts')
    revalidatePath(`/accounts/${validated.id}`)
    revalidatePath(`/accounts/${validated.id}/voice`)
    revalidatePath(`/accounts/${validated.id}/goals`)
    revalidatePath(`/accounts/${validated.id}/preferences`)
    revalidatePath(`/accounts/${validated.id}/knowledge`)

    return { success: true }
  } catch (error: any) {
    console.error('Error updating account identity:', error)
    return {
      success: false,
      error: error?.message || 'Failed to update identity'
    }
  }
}

export async function deleteAccountAction(accountId: string) {
  try {
    const parsed = z
      .string()
      .uuid('Invalid account identifier')
      .safeParse(accountId)
    if (!parsed.success) {
      return { success: false, error: 'Invalid account identifier' }
    }
    const id = parsed.data

    // Verify account exists
    const existing = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, id)
    })
    if (!existing) {
      return { success: false, error: 'Account identity not found' }
    }

    // Soft delete: mark identity as inactive (isActive: false)
    await db
      .update(accountsTable)
      .set({
        isActive: false,
        updatedAt: new Date()
      })
      .where(eq(accountsTable.id, id))

    // Revalidate paths
    revalidatePath('/')
    revalidatePath('/accounts')
    revalidatePath(`/accounts/${id}`)

    return { success: true }
  } catch (error: any) {
    console.error('Error deactivating account identity:', error)
    return {
      success: false,
      error: error?.message || 'Failed to deactivate identity'
    }
  }
}

export async function reactivateAccountAction(accountId: string) {
  try {
    const parsed = z
      .string()
      .uuid('Invalid account identifier')
      .safeParse(accountId)
    if (!parsed.success) {
      return { success: false, error: 'Invalid account identifier' }
    }
    const id = parsed.data

    // Verify account exists
    const existing = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, id)
    })
    if (!existing) {
      return { success: false, error: 'Account identity not found' }
    }

    // Reactivate identity (isActive: true)
    await db
      .update(accountsTable)
      .set({
        isActive: true,
        updatedAt: new Date()
      })
      .where(eq(accountsTable.id, id))

    // Revalidate paths
    revalidatePath('/')
    revalidatePath('/accounts')
    revalidatePath(`/accounts/${id}`)

    return { success: true }
  } catch (error: any) {
    console.error('Error reactivating account identity:', error)
    return {
      success: false,
      error: error?.message || 'Failed to reactivate identity'
    }
  }
}
