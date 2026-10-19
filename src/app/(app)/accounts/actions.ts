'use server'

import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { pinActiveAccount, writeActiveAccountCookie } from '@/lib/active-account'
import {
  deriveHeadline,
  IdentityProfileSchema
} from '@/lib/identity-profile'
import { insertIdentity, updateIdentity } from '@/lib/identity-write'
import { INACTIVE_ACCOUNT_MESSAGE } from '@/lib/inactive-account'
import { AccountIdSchema } from '@/lib/setup-payloads'
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

/**
 * Creates in progress or recently done, by the key the create page sends with
 * each submission. A repeat of the same submission (a second click that got
 * past the page, a retried request) gets the first one's result instead of a
 * second identity. Held in memory, so it covers one server process.
 */
const recentCreates = new Map<string, Promise<{ redirectTo: string }>>()
const CREATE_KEY_TTL_MS = 10 * 60 * 1000

export async function createAccount(formData: FormData) {
  const key = formData.get('createKey')
  if (typeof key !== 'string' || !key || key.length > 64) {
    return createAccountOnce(formData)
  }
  const existing = recentCreates.get(key)
  if (existing) return existing
  const created = createAccountOnce(formData)
  recentCreates.set(key, created)
  // A failed create is forgotten straight away so the user can try again.
  created.then(
    () => setTimeout(() => recentCreates.delete(key), CREATE_KEY_TTL_MS),
    () => recentCreates.delete(key)
  )
  return created
}

async function createAccountOnce(formData: FormData) {
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
  // concurrent create can take the handle first; retry once with a random
  // suffix (a timestamp collided when two creates landed in the same millisecond).
  let account: typeof accountsTable.$inferSelect
  try {
    account = await insertIdentity(db, accountValues(candidateHandle), data)
  } catch (err: any) {
    if (err?.code === '23505' || err?.cause?.code === '23505') {
      const fallbackHandle = `${candidateHandle}-${crypto.randomUUID().slice(0, 6)}`
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
  id: AccountIdSchema,
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
    if (!existing.isActive) {
      return { success: false, error: INACTIVE_ACCOUNT_MESSAGE }
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

const setAccountActiveSchema = z.object({
  id: AccountIdSchema,
  isActive: z.boolean()
})

export type SetAccountActiveResult =
  | { success: true; isActive: boolean; changed: boolean }
  | { success: false; error: string }

/**
 * Activates or deactivates one identity. The caller names the status it wants
 * rather than asking for a flip, so a repeated or stale request (a double
 * click, a second tab) leaves the identity as asked instead of undoing it, and
 * the update is scoped to this one id so no other identity can change.
 *
 * Only the status changes. A deactivated identity stays listed, keeps its
 * settings, ideas and posts, and stays selected if it was; runs are refused
 * for it until it is activated again. The selection is never moved here.
 */
export async function setAccountActiveAction(
  accountId: string,
  isActive: boolean
): Promise<SetAccountActiveResult> {
  const verb = isActive ? 'activate' : 'deactivate'
  try {
    const parsed = setAccountActiveSchema.safeParse({ id: accountId, isActive })
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues.map(i => i.message).join('. ')
      }
    }
    const { id } = parsed.data

    // With no identity picked yet the one shown is a fallback that prefers
    // active identities; pin it first so this change can't move it.
    await pinActiveAccount()

    // Only a row not already in the asked-for state is written, so updatedAt
    // (which keys the profile form) moves only on a real change.
    const [updated] = await db
      .update(accountsTable)
      .set({ isActive: parsed.data.isActive, updatedAt: new Date() })
      .where(
        and(
          eq(accountsTable.id, id),
          ne(accountsTable.isActive, parsed.data.isActive)
        )
      )
      .returning({ id: accountsTable.id })

    if (!updated) {
      const existing = await db.query.accountsTable.findFirst({
        where: eq(accountsTable.id, id),
        columns: { id: true }
      })
      if (!existing) {
        return { success: false, error: 'Identity not found' }
      }
    }

    // The root layout holds the identity switcher, which shows each
    // identity's status, and every page under it shows status or depends on it.
    revalidatePath('/', 'layout')

    return { success: true, isActive: parsed.data.isActive, changed: !!updated }
  } catch (error: any) {
    console.error(`Error trying to ${verb} account identity:`, error)
    return {
      success: false,
      error: error?.message || `Failed to ${verb} identity`
    }
  }
}
