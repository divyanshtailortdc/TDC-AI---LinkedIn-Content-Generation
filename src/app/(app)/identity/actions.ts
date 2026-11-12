'use server'

import { db } from '@/db'
import { accountsTable, platformConnectionsTable } from '@/db/schema'
import { IDENTITY_PATH, setActiveIdentity } from '@/lib/identity'
import {
  cleanChannelSettings,
  isPlatformId,
  STARTING_FORMATS,
  type ChannelSettings,
  type PlatformId
} from '@/lib/formats'
import {
  ACCOUNT_TYPES,
  deriveHeadline,
  IdentityProfileSchema,
  parseAccountType
} from '@/lib/identity-profile'
import { insertIdentity, updateIdentity } from '@/lib/identity-write'
import { findOwnedAccount, ownedByUser } from '@/lib/ownership'
import { requireUser } from '@/lib/session'
import { AccountIdSchema } from '@/lib/setup-payloads'
import { and, eq, gt, isNull } from 'drizzle-orm'
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

/** A JSON form field, or null when it is missing or not JSON. */
function jsonField(formData: FormData, key: string): unknown {
  const raw = formData.get(key)
  if (typeof raw !== 'string' || !raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Where a new identity posts and how each platform should sound (its style,
 * and for every platform but LinkedIn who follows it there, its tone and its
 * emoji), from the setup's first and last steps. Each picked platform starts
 * with its main formats (STARTING_FORMATS); none picked keeps the LinkedIn
 * default.
 */
function channelsFromFormData(formData: FormData): {
  enabledFormats: string[]
  channelSettings: ChannelSettings
} | null {
  const picked = jsonField(formData, 'platforms')
  const platforms = Array.isArray(picked)
    ? Array.from(new Set(picked.filter(isPlatformId)))
    : []
  if (platforms.length === 0) return null
  const styles = jsonField(formData, 'styles') as Record<string, unknown> | null
  const notes = jsonField(formData, 'notes') as Record<string, unknown> | null
  const settings = cleanChannelSettings(
    Object.fromEntries(
      platforms.map((p: PlatformId) => {
        const note = notes?.[p]
        return [
          p,
          {
            ...(note && typeof note === 'object' ? note : {}),
            style: styles?.[p]
          }
        ]
      })
    )
  )
  return {
    enabledFormats: platforms.flatMap(p => STARTING_FORMATS[p]),
    channelSettings: settings
  }
}

/** A create repeated within this long (a second click, a retried request) makes nothing. */
const REPEAT_CREATE_MS = 60_000

/**
 * Creates an identity for the signed-in user and makes it the active one. A
 * user can own several. The same name created again within a minute is
 * taken as the same create repeated (a second click, a retried request,
 * another tab), so nothing is inserted and the user is sent to that one.
 */
export async function createAccount(formData: FormData) {
  const user = await requireUser()

  const accountType = parseAccountType(formData.get('accountType'))
  const parsed = IdentityProfileSchema.safeParse(profileFromFormData(formData))
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(i => i.message).join(', '))
  }
  const data = parsed.data

  const repeated = await db.query.accountsTable.findFirst({
    where: and(
      ownedByUser(user.id),
      eq(accountsTable.name, data.name),
      gt(accountsTable.createdAt, new Date(Date.now() - REPEAT_CREATE_MS))
    )
  })
  if (repeated) {
    await setActiveIdentity(repeated.id)
    revalidatePath('/', 'layout')
    return { redirectTo: IDENTITY_PATH }
  }

  // The account, its offering and audience, and where it posts are written
  // together.
  const created = await insertIdentity(
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
    data,
    channelsFromFormData(formData)
  )
  // A connection made before the user had any identity belongs to none; this
  // one takes it on (at most one per platform: they were one per user).
  await db
    .update(platformConnectionsTable)
    .set({ accountId: created.id })
    .where(
      and(
        eq(platformConnectionsTable.userId, user.id),
        isNull(platformConnectionsTable.accountId)
      )
    )
  // Every page from here on works on the new identity.
  await setActiveIdentity(created.id)

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
  /** A person or a brand; left out keeps the saved type. */
  accountType: z.enum(ACCOUNT_TYPES).optional()
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

/**
 * Makes one of the user's identities the active one: every page and action
 * works on it from the next request. Someone else's identity reads as not
 * found.
 */
export async function switchIdentity(rawAccountId: string) {
  const user = await requireUser()
  const account = await findOwnedAccount(db, user.id, rawAccountId)
  if (!account) return { success: false as const, error: 'Identity not found' }
  await setActiveIdentity(account.id)
  revalidatePath('/', 'layout')
  return { success: true as const }
}
