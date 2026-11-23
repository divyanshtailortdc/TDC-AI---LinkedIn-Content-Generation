'use server'

import { db } from '@/db'
import {
  accountsTable,
  platformConnectionsTable,
  preferencesTable
} from '@/db/schema'
import { IDENTITY_PATH, setActiveIdentity } from '@/lib/identity'
import {
  cleanChannelSettings,
  formatsForPlatforms,
  isCreatablePlatform,
  isPlatformId,
  resolveChannels,
  STARTING_FORMATS,
  type ChannelSettings,
  type FormatId,
  type PlatformId
} from '@/lib/formats'
import {
  ACCOUNT_TYPES,
  deriveHeadline,
  handleFrom,
  IdentityProfileSchema,
  parseAccountType
} from '@/lib/identity-profile'
import {
  contextIdentityAfterSave,
  headlineAfterSave
} from '@/lib/identity-change'
import {
  insertIdentity,
  updateIdentity,
  type IdentityDb
} from '@/lib/identity-write'
import { findOwnedAccount, ownedByUser } from '@/lib/ownership'
import {
  runProfileAnalysis,
  syncProfileAnalyses
} from '@/lib/profile-insights/analyze'
import {
  cleanProfileLinks,
  mainProfileLink,
  mergeProfileLinks,
  otherProfileLink,
  platformOfLink,
  profileLinkErrors,
  profileLinksOf,
  type ProfileLinks
} from '@/lib/profile-links'
import { requireUser } from '@/lib/session'
import { AccountIdSchema } from '@/lib/setup-payloads'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'

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
 * Profile links typed into a form, by platform: a link with a problem fails
 * the save with its message rather than being dropped.
 */
function typedProfileLinks(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const typed = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => isPlatformId(entry[0]) && typeof entry[1] === 'string'
    )
  )
  const problems = Object.values(profileLinkErrors(typed as ProfileLinks))
  if (problems.length > 0) throw new Error(problems.join(' '))
  return typed
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
    ? Array.from(new Set(picked.filter(isPlatformId))).filter(isCreatablePlatform)
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

/**
 * Starts analyzing each profile link that was added or changed, and drops
 * the analysis of each link removed (src/lib/profile-insights). The analyses
 * run after the response; the Profile page follows them. Never fails the
 * save it follows: the links are saved either way.
 */
async function analyzeChangedLinks(
  accountId: string,
  saved: ProfileLinks,
  next: ProfileLinks
) {
  try {
    const claims = await syncProfileAnalyses(accountId, saved, next)
    if (claims.length > 0) after(() => Promise.all(claims.map(runProfileAnalysis)))
  } catch (error) {
    console.error('Could not start analyzing profile links:', error)
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
  // A link per platform; the main one is also the account's single link.
  const profileLinks = cleanProfileLinks(
    typedProfileLinks(jsonField(formData, 'profileLinks'))
  )
  const mainLink = mainProfileLink(profileLinks)

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
      handle: handleFrom(mainLink, data.name),
      headline: deriveHeadline(data),
      bio: data.description,
      company: data.company || null,
      industry: data.industry,
      linkedinUrl: mainLink,
      profileLinks,
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
  // Each profile link given is read for how the identity posts there.
  await analyzeChangedLinks(created.id, {}, profileLinks)
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
  accountType: z.enum(ACCOUNT_TYPES).optional(),
  /**
   * The Profile form's link per platform, over the saved ones; an empty one
   * removes that platform's link. Left out, `linkedinUrl` (one link, as the
   * AI setup suggests it) goes to the platform it is on.
   */
  profileLinks: z.record(z.string(), z.string()).optional(),
  /**
   * Where the identity posts (the Profile step's Platforms); left out keeps
   * them. Saved as the formats turned on (formatsForPlatforms).
   */
  platforms: z.array(z.string()).optional()
})

export type UpdateAccountInput = z.input<typeof updateAccountSchema>

/**
 * The formats to save for the platforms picked on the Profile step, or null
 * when they are the ones it already posts on. Throws when none is left.
 */
async function changedPlatformFormats(
  database: IdentityDb,
  accountId: string,
  picked: string[]
): Promise<FormatId[] | null> {
  const platforms = Array.from(new Set(picked.filter(isPlatformId))).filter(
    isCreatablePlatform
  )
  if (platforms.length === 0) {
    throw new Error('Keep at least one platform to post on.')
  }
  // Locked until the save commits, so a Preferences save in between is not
  // overwritten with formats worked out from before it.
  const [row] = await database
    .select({ enabledFormats: preferencesTable.enabledFormats })
    .from(preferencesTable)
    .where(eq(preferencesTable.accountId, accountId))
    .for('update')
  const current = resolveChannels(row).platforms
  const same =
    current.length === platforms.length && platforms.every(p => current.includes(p))
  return same ? null : formatsForPlatforms(row?.enabledFormats, platforms)
}

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
    const saved = profileLinksOf(existing)
    let profileLinks: ProfileLinks = saved
    if (validated.profileLinks) {
      profileLinks = mergeProfileLinks(
        saved,
        typedProfileLinks(validated.profileLinks)
      )
    } else if (
      validated.linkedinUrl &&
      validated.linkedinUrl !== (existing.linkedinUrl || '')
    ) {
      // One link from the AI setup: it replaces that platform's. A link on no
      // platform has no place to go.
      const on = platformOfLink(validated.linkedinUrl)
      if (on) profileLinks = mergeProfileLinks(saved, { [on]: validated.linkedinUrl })
    }
    const mainLink = mainProfileLink(profileLinks) ?? otherProfileLink(existing)

    // The handle only follows the main link; renaming keeps the old handle.
    let handle = existing.handle
    if (mainLink && mainLink !== (existing.linkedinUrl || '')) {
      handle = handleFrom(mainLink, validated.name)
    }

    // The profile and where it posts are saved together, or neither is.
    const enabledFormats = await db.transaction(async tx => {
      const formats = validated.platforms
        ? await changedPlatformFormats(tx, validated.id, validated.platforms)
        : null
      await updateIdentity(
        tx,
        validated.id,
        {
          name: validated.name,
          ...(validated.accountType
            ? { accountType: validated.accountType }
            : {}),
          handle,
          // It is made from the company and industry, so it follows them.
          headline: headlineAfterSave(existing.headline, existing, validated),
          bio: validated.description,
          company: validated.company || null,
          industry: validated.industry,
          linkedinUrl: mainLink,
          profileLinks,
          websiteUrl: validated.websiteUrl || null,
          // Changed to another company by hand: the voice, knowledge and goals
          // still belong to the old one until Re-analyze switches them over.
          contextIdentity: contextIdentityAfterSave(
            existing.contextIdentity,
            existing,
            {
              name: validated.name,
              company: validated.company || null,
              websiteUrl: validated.websiteUrl || null
            }
          ),
          updatedAt: new Date()
        },
        validated
      )
      if (formats) {
        // Only the formats change: each platform's style and notes are kept,
        // so a platform added back sounds as it did.
        await tx
          .insert(preferencesTable)
          .values({ accountId: validated.id, enabledFormats: formats })
          .onConflictDoUpdate({
            target: preferencesTable.accountId,
            set: { enabledFormats: formats, updatedAt: new Date() }
          })
      }
      return formats
    })
    await analyzeChangedLinks(validated.id, saved, profileLinks)
    // Where it posts shows on every page (ideas, posts, goals, schedule).
    revalidatePath('/', enabledFormats ? 'layout' : undefined)
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
