import {
  accountsTable,
  audiencesTable,
  brandThemesTable,
  goalsTable,
  ideasTable,
  knowledgeDocumentsTable,
  newslettersTable,
  offeringsTable,
  platformConnectionsTable,
  platformInsightsTable,
  postDraftsTable,
  preferencesTable,
  runsTable,
  samplePostsTable,
  schedulesTable,
  voiceConfigsTable,
  type Guardrails
} from '@/db/schema'
import {
  cleanChannelSettings,
  isPlatformId,
  type ChannelSettings,
  type PlatformId
} from '@/lib/formats'
import { hasGoalTitle } from '@/lib/goal-titles'
import { analyzedLink } from '@/lib/profile-insights/claim'
import { removedProfileLinks } from '@/lib/identity-change'
import { deriveHeadline, handleFrom } from '@/lib/identity-profile'
import {
  upsertPrimaryOfferingAndAudience,
  type IdentityDb,
  type IdentityTx
} from '@/lib/identity-write'
import {
  cleanProfileLinks,
  mainProfileLink,
  profileLinksOf,
  type ProfileLinks
} from '@/lib/profile-links'
import { ACTIVE_RUN_STATUSES } from '@/lib/run-status'
import { and, asc, count, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'

/**
 * Switching an identity to another company: Zomato rewritten as TDCCommerce.
 *
 * Re-analyze used to fill only the gaps around what was saved, so the old
 * company's voice, links, knowledge, goals and ideas went on steering every
 * post. A switch replaces all of it in one transaction, so a failure part way
 * leaves the identity as it was:
 *
 * - replaced: the profile (links: only the new company's), voice, guardrails
 *   and how each platform sounds; the headline and handle follow;
 * - retired, kept: active goals are paused (the new goal is the active one),
 *   open ideas rejected, sample posts switched off, extra offerings switched
 *   off, auto-publish turned off on connected accounts;
 * - removed: the knowledge documents picked in the review (their embeddings
 *   go with them), profile insights, untouched newsletter suggestions, extra
 *   audiences, the schedule's goal picks, and the brand theme when picked;
 * - kept as they are: posts, publications, runs and their research, and
 *   newsletters the user acted on.
 *
 * Prompts then read only history made after the switch (accounts.context_since).
 * Takes the database as an argument so it can run against any connection.
 */

/** The Profile fields, as they will be saved. */
export type SwitchProfile = {
  name: string
  company: string
  description: string
  targetAudience: string
  offerings: string
  industry: string
  websiteUrl: string
}

/** Voice settings; any left out take the column default, never the old value. */
export type SwitchVoice = {
  tone?: string
  derivedStyleRubric?: string
  formality?: number | null
  directness?: number | null
  perspective?: string
  emojiPolicy?: string
  hashtagPolicy?: string
  bannedWords?: string[]
}

/** A goal as the goals table stores it. */
export type SwitchGoal = {
  title: string
  objective: string
  keyMessage: string
  desiredAction: string | null
  targetUrl: string | null
  linkStrategy: 'body' | 'first_comment'
  platforms: string[]
}

export type SwitchPlan = {
  profile: SwitchProfile
  /** Exactly the links the identity keeps; any other saved link is removed. */
  profileLinks: ProfileLinks
  /** A typed link on no platform's site, kept as the main link when no platform has one. */
  otherLink?: string | null
  voice: SwitchVoice
  guardrails: Guardrails
  /** How each platform sounds now; a platform left out goes back to its default. */
  channels: ChannelSettings
  /** The new company's goal, made the active one; null leaves no goal active. */
  goal: SwitchGoal | null
  /** Knowledge documents to remove, by id; others stay. */
  removeKnowledgeIds: string[]
  /** Clears the logo, colours, fonts and footer text. */
  resetBrandTheme: boolean
}

export type SwitchSummary = {
  linksRemoved: string[]
  goal: 'created' | 'reactivated' | null
  goalsPaused: number
  knowledgeRemoved: number
  ideasRejected: number
  samplePostsRetired: number
  insightsCleared: number
  /** Platforms whose insights were kept: their link stays the same. */
  insightsKept: PlatformId[]
  newslettersRemoved: number
  brandThemeReset: boolean
  offeringsRetired: number
  audiencesRemoved: number
  /** Connected accounts whose auto-publish was turned off, as "Platform: name". */
  autoPublishOff: Array<{ platform: PlatformId; name: string | null }>
}

/** The voice columns' defaults (voice_configs in src/db/schema.ts). */
export const VOICE_DEFAULTS = {
  tone: 'candid',
  perspective: 'I',
  formality: 3,
  directness: 4,
  emojiPolicy: 'none',
  hashtagPolicy: '0-3, end of post'
} as const

/** Ideas still waiting to be decided on or drafted. */
const OPEN_IDEA_STATUSES = ['proposed', 'approved']
/** Newsletter suggestions nobody acted on; the rest record what the user did. */
const UNTOUCHED_NEWSLETTER = 'discovered'

/** Why the identity cannot be switched right now. */
export class IdentitySwitchBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentitySwitchBlockedError'
  }
}

type Reader = IdentityDb | IdentityTx

/**
 * What stops a switch: a run or drafting still working from the old
 * company's details would save ideas or posts for it after the switch.
 * Deleting the identity is stopped the same way (`action`), since they would
 * write for an identity that is gone.
 */
export async function switchBlocker(
  database: Reader,
  accountId: string,
  action: 'switch' | 'delete' = 'switch'
): Promise<string | null> {
  const then = action === 'delete' ? 'then delete it' : 'then switch'
  const [[run], [drafting]] = await Promise.all([
    database
      .select({ n: count() })
      .from(runsTable)
      .where(
        and(
          eq(runsTable.accountId, accountId),
          inArray(runsTable.status, ACTIVE_RUN_STATUSES)
        )
      ),
    database
      .select({ n: count() })
      .from(ideasTable)
      .where(and(eq(ideasTable.accountId, accountId), eq(ideasTable.status, 'drafting')))
  ])
  if ((run?.n ?? 0) > 0) {
    return `A run is still working for this identity. Wait for it to finish, or stop it, ${then}.`
  }
  if ((drafting?.n ?? 0) > 0) {
    return `Posts are still being written for this identity. Wait for them to finish, ${then}.`
  }
  return null
}

/** What a switch would retire, for the review to show before anything changes. */
export type SwitchPreview = {
  knowledgeDocs: Array<{
    id: string
    title: string
    sourceType: string
    sourceUrl: string | null
  }>
  openIdeas: number
  activeGoals: string[]
  samplePosts: number
  /** The voice or a platform holds a style learned from the old posts. */
  learnedStyle: boolean
  /** The analyzed profile on each platform; a switch keeps the ones whose link stays. */
  insights: Array<{ platform: PlatformId; profileUrl: string }>
  /** What the brand theme holds that names the old company; null when it holds nothing. */
  brandTheme: { logo: boolean; footerText: string | null; colors: boolean } | null
  untouchedNewsletters: number
  /** Newsletters the user saved, signed up to or follows: kept, but chosen for the old company. */
  followedNewsletters: number
  posts: number
  connections: Array<{ platform: PlatformId; name: string | null; autoPublish: boolean }>
  extraOfferings: number
  extraAudiences: number
  /** Why it cannot be switched now (switchBlocker), or null. */
  blocked: string | null
}

export async function switchPreview(
  database: IdentityDb,
  accountId: string
): Promise<SwitchPreview> {
  const [
    docs,
    [ideas],
    goals,
    [samples],
    voice,
    prefs,
    insights,
    brand,
    newsletters,
    [posts],
    connections,
    [offerings],
    [audiences],
    blocked
  ] = await Promise.all([
    database
      .select({
        id: knowledgeDocumentsTable.id,
        title: knowledgeDocumentsTable.title,
        sourceType: knowledgeDocumentsTable.sourceType,
        sourceUrl: knowledgeDocumentsTable.sourceUrl
      })
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.accountId, accountId))
      .orderBy(asc(knowledgeDocumentsTable.createdAt)),
    database
      .select({ n: count() })
      .from(ideasTable)
      .where(
        and(
          eq(ideasTable.accountId, accountId),
          inArray(ideasTable.status, OPEN_IDEA_STATUSES)
        )
      ),
    database
      .select({ title: goalsTable.title })
      .from(goalsTable)
      .where(and(eq(goalsTable.accountId, accountId), eq(goalsTable.isActive, true)))
      .orderBy(desc(goalsTable.createdAt)),
    database
      .select({ n: count() })
      .from(samplePostsTable)
      .where(
        and(eq(samplePostsTable.accountId, accountId), eq(samplePostsTable.isActive, true))
      ),
    database
      .select({
        rubric: voiceConfigsTable.derivedStyleRubric,
        raw: voiceConfigsTable.rawSamplesText
      })
      .from(voiceConfigsTable)
      .where(eq(voiceConfigsTable.accountId, accountId)),
    database
      .select({ channelSettings: preferencesTable.channelSettings })
      .from(preferencesTable)
      .where(eq(preferencesTable.accountId, accountId)),
    database
      .select({
        platform: platformInsightsTable.platform,
        profileUrl: platformInsightsTable.profileUrl
      })
      .from(platformInsightsTable)
      .where(eq(platformInsightsTable.accountId, accountId)),
    database
      .select()
      .from(brandThemesTable)
      .where(eq(brandThemesTable.accountId, accountId)),
    database
      .select({ status: newslettersTable.status, n: count() })
      .from(newslettersTable)
      .where(eq(newslettersTable.accountId, accountId))
      .groupBy(newslettersTable.status),
    database
      .select({ n: count() })
      .from(postDraftsTable)
      .where(eq(postDraftsTable.accountId, accountId)),
    database
      .select({
        platform: platformConnectionsTable.platform,
        name: platformConnectionsTable.name,
        autoPublish: platformConnectionsTable.autoPublish
      })
      .from(platformConnectionsTable)
      .where(eq(platformConnectionsTable.accountId, accountId)),
    database
      .select({ n: count() })
      .from(offeringsTable)
      .where(and(eq(offeringsTable.accountId, accountId), eq(offeringsTable.isActive, true))),
    database
      .select({ n: count() })
      .from(audiencesTable)
      .where(eq(audiencesTable.accountId, accountId)),
    switchBlocker(database, accountId)
  ])

  const channels = cleanChannelSettings(prefs[0]?.channelSettings)
  const theme = brand[0]
  const colors = Boolean(
    theme?.primaryColor || theme?.accentColor || theme?.backgroundColor
  )
  const newsletterCount = (statuses: string[]) =>
    newsletters
      .filter(row => statuses.includes(row.status))
      .reduce((sum, row) => sum + Number(row.n), 0)

  return {
    knowledgeDocs: docs,
    openIdeas: Number(ideas?.n ?? 0),
    activeGoals: goals.map(g => g.title),
    samplePosts: Number(samples?.n ?? 0),
    learnedStyle: Boolean(
      voice[0]?.rubric?.trim() ||
        voice[0]?.raw?.trim() ||
        Object.values(channels).some(note => note && 'rubric' in note && note.rubric)
    ),
    insights: insights.flatMap(row =>
      isPlatformId(row.platform)
        ? [{ platform: row.platform, profileUrl: row.profileUrl }]
        : []
    ),
    brandTheme:
      theme && (theme.logoImage || theme.footerText || colors)
        ? { logo: Boolean(theme.logoImage), footerText: theme.footerText, colors }
        : null,
    untouchedNewsletters: newsletterCount([UNTOUCHED_NEWSLETTER]),
    followedNewsletters: newsletterCount([
      'saved',
      'pending_confirmation',
      'subscribed',
      'active'
    ]),
    posts: Number(posts?.n ?? 0),
    connections: connections
      .filter(c => isPlatformId(c.platform))
      .map(c => ({ platform: c.platform, name: c.name, autoPublish: c.autoPublish })),
    // The first offering and audience are the profile's; the rest predate it.
    extraOfferings: Math.max(0, Number(offerings?.n ?? 0) - 1),
    extraAudiences: Math.max(0, Number(audiences?.n ?? 0) - 1),
    blocked
  }
}

/** Whether a platform's analyzed profile is still the identity's after a switch to `links`. */
export function keepsInsight(
  links: ProfileLinks,
  platform: string,
  profileUrl: string
): boolean {
  if (!isPlatformId(platform)) return false
  const link = links[platform]
  return Boolean(link) && analyzedLink(platform, link!) === profileUrl
}

/** The account's oldest row in `table`, which the Profile form edits. */
async function primaryId(
  tx: IdentityTx,
  table: typeof offeringsTable | typeof audiencesTable,
  accountId: string
): Promise<string | null> {
  const [row] = await tx
    .select({ id: table.id })
    .from(table)
    .where(eq(table.accountId, accountId))
    .orderBy(asc(table.createdAt))
    .limit(1)
  return row?.id ?? null
}

/**
 * Switches the identity to the company `plan` describes, all or nothing.
 * Throws IdentitySwitchBlockedError while a run or drafting is working.
 */
export async function switchIdentityData(
  database: IdentityDb,
  accountId: string,
  plan: SwitchPlan,
  now = new Date()
): Promise<SwitchSummary> {
  return database.transaction(async tx => {
    // Locks the row, so two switches (or a switch and a profile save) run
    // one after the other.
    const [existing] = await tx
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .for('update')
    if (!existing) throw new Error('Identity not found')
    const blocked = await switchBlocker(tx, accountId)
    if (blocked) throw new IdentitySwitchBlockedError(blocked)

    const profile = plan.profile
    const links = cleanProfileLinks(plan.profileLinks)
    const mainLink = mainProfileLink(links) ?? plan.otherLink?.trim() ?? null
    await tx
      .update(accountsTable)
      .set({
        name: profile.name.trim(),
        handle: handleFrom(mainLink, profile.name),
        headline: deriveHeadline({
          name: profile.name.trim(),
          company: profile.company.trim() || undefined,
          industry: profile.industry.trim() || undefined
        }),
        bio: profile.description.trim(),
        company: profile.company.trim() || null,
        industry: profile.industry.trim(),
        websiteUrl: profile.websiteUrl.trim() || null,
        linkedinUrl: mainLink,
        profileLinks: links,
        // The database's clock, which stamps the rows made after the switch.
        contextSince: sql`now()`,
        contextIdentity: null,
        updatedAt: now
      })
      .where(eq(accountsTable.id, accountId))

    // The profile's offering and audience; rows from before the single
    // fields described the old company too.
    await upsertPrimaryOfferingAndAudience(tx, accountId, {
      offerings: profile.offerings,
      targetAudience: profile.targetAudience
    })
    const primaryOffering = await primaryId(tx, offeringsTable, accountId)
    const primaryAudience = await primaryId(tx, audiencesTable, accountId)
    const offeringsRetired = await tx
      .update(offeringsTable)
      .set({ isActive: false, updatedAt: now })
      .where(
        and(
          eq(offeringsTable.accountId, accountId),
          eq(offeringsTable.isActive, true),
          primaryOffering ? ne(offeringsTable.id, primaryOffering) : undefined
        )
      )
      .returning({ id: offeringsTable.id })
    const audiencesRemoved = await tx
      .delete(audiencesTable)
      .where(
        and(
          eq(audiencesTable.accountId, accountId),
          primaryAudience ? ne(audiencesTable.id, primaryAudience) : undefined
        )
      )
      .returning({ id: audiencesTable.id })

    // The voice: what was suggested, else the defaults. A style learned from
    // the old company's posts goes, and so do those posts.
    const voice = plan.voice
    const voiceValues = {
      tone: voice.tone?.trim() || VOICE_DEFAULTS.tone,
      perspective: voice.perspective?.trim() || VOICE_DEFAULTS.perspective,
      formality: voice.formality ?? VOICE_DEFAULTS.formality,
      directness: voice.directness ?? VOICE_DEFAULTS.directness,
      emojiPolicy: voice.emojiPolicy?.trim() || VOICE_DEFAULTS.emojiPolicy,
      hashtagPolicy: voice.hashtagPolicy?.trim() || VOICE_DEFAULTS.hashtagPolicy,
      bannedWords: voice.bannedWords ?? [],
      derivedStyleRubric: voice.derivedStyleRubric?.trim() || null,
      rawSamplesText: null,
      updatedAt: now
    }
    await tx
      .insert(voiceConfigsTable)
      .values({ accountId, ...voiceValues })
      .onConflictDoUpdate({ target: voiceConfigsTable.accountId, set: voiceValues })
    const samplePostsRetired = await tx
      .update(samplePostsTable)
      .set({ isActive: false })
      .where(
        and(eq(samplePostsTable.accountId, accountId), eq(samplePostsTable.isActive, true))
      )
      .returning({ id: samplePostsTable.id })

    // Where it posts stays; how each platform sounds, and the guardrails,
    // are the new company's.
    const channels = cleanChannelSettings(plan.channels)
    for (const note of Object.values(channels)) {
      if (note && 'rubric' in note) delete note.rubric
    }
    const [prefs] = await tx
      .select({ id: preferencesTable.id })
      .from(preferencesTable)
      .where(eq(preferencesTable.accountId, accountId))
    if (prefs) {
      await tx
        .update(preferencesTable)
        .set({ channelSettings: channels, guardrails: plan.guardrails, updatedAt: now })
        .where(eq(preferencesTable.id, prefs.id))
    } else {
      await tx
        .insert(preferencesTable)
        .values({ accountId, channelSettings: channels, guardrails: plan.guardrails })
    }

    // Goals: the old ones are paused, so only the new company's steers runs.
    // One with the same title (switching back) is brought back instead.
    const goalsPaused = await tx
      .update(goalsTable)
      .set({ isActive: false, updatedAt: now })
      .where(and(eq(goalsTable.accountId, accountId), eq(goalsTable.isActive, true)))
      .returning({ id: goalsTable.id })
    let goal: SwitchSummary['goal'] = null
    if (plan.goal) {
      const all = await tx
        .select({ id: goalsTable.id, title: goalsTable.title })
        .from(goalsTable)
        .where(eq(goalsTable.accountId, accountId))
      const same = all.find(g => hasGoalTitle([g.title], plan.goal!.title))
      const values = { ...plan.goal, isActive: true, updatedAt: now }
      if (same) {
        await tx.update(goalsTable).set(values).where(eq(goalsTable.id, same.id))
        goal = 'reactivated'
      } else {
        await tx.insert(goalsTable).values({ accountId, ...values })
        goal = 'created'
      }
    }
    // Days that named the old goals would find none: every day serves the
    // active goals again.
    await tx
      .update(schedulesTable)
      .set({ dayGoals: null, updatedAt: now })
      .where(and(eq(schedulesTable.accountId, accountId), isNotNull(schedulesTable.dayGoals)))

    const knowledgeRemoved =
      plan.removeKnowledgeIds.length > 0
        ? await tx
            .delete(knowledgeDocumentsTable)
            .where(
              and(
                eq(knowledgeDocumentsTable.accountId, accountId),
                inArray(knowledgeDocumentsTable.id, plan.removeKnowledgeIds)
              )
            )
            .returning({ id: knowledgeDocumentsTable.id })
        : []

    // Ideas written for the old company are rejected, not deleted: they stay
    // under Rejected, and no run waits on them. No feedback row is written,
    // so they do not teach future runs what to avoid.
    const ideasRejected = await tx
      .update(ideasTable)
      .set({ status: 'rejected', updatedAt: now })
      .where(
        and(
          eq(ideasTable.accountId, accountId),
          inArray(ideasTable.status, OPEN_IDEA_STATUSES)
        )
      )
      .returning({ id: ideasTable.id })
    await tx
      .update(runsTable)
      .set({ status: 'completed', updatedAt: now })
      .where(
        and(
          eq(runsTable.accountId, accountId),
          eq(runsTable.status, 'awaiting_idea_approval')
        )
      )

    // What was learned from a profile the identity keeps (a link saved by
    // hand for the new company) stays; every other profile's goes.
    const insightRows = await tx
      .select({
        id: platformInsightsTable.id,
        platform: platformInsightsTable.platform,
        profileUrl: platformInsightsTable.profileUrl
      })
      .from(platformInsightsTable)
      .where(eq(platformInsightsTable.accountId, accountId))
    const keptInsights = insightRows.filter(row =>
      keepsInsight(links, row.platform, row.profileUrl)
    )
    const clearedIds = insightRows
      .filter(row => !keptInsights.includes(row))
      .map(row => row.id)
    if (clearedIds.length > 0) {
      await tx
        .delete(platformInsightsTable)
        .where(inArray(platformInsightsTable.id, clearedIds))
    }

    const newslettersRemoved = await tx
      .delete(newslettersTable)
      .where(
        and(
          eq(newslettersTable.accountId, accountId),
          eq(newslettersTable.status, UNTOUCHED_NEWSLETTER)
        )
      )
      .returning({ id: newslettersTable.id })

    const brandThemeReset = plan.resetBrandTheme
      ? (
          await tx
            .delete(brandThemesTable)
            .where(eq(brandThemesTable.accountId, accountId))
            .returning({ id: brandThemesTable.id })
        ).length > 0
      : false

    // The old company's accounts stay connected, but nothing goes out on
    // them by itself until the user checks them.
    const autoPublishOff = await tx
      .update(platformConnectionsTable)
      .set({ autoPublish: false, updatedAt: now })
      .where(
        and(
          eq(platformConnectionsTable.accountId, accountId),
          eq(platformConnectionsTable.autoPublish, true)
        )
      )
      .returning({
        platform: platformConnectionsTable.platform,
        name: platformConnectionsTable.name
      })

    return {
      linksRemoved: removedProfileLinks(profileLinksOf(existing), links),
      goal,
      goalsPaused: goalsPaused.length,
      knowledgeRemoved: knowledgeRemoved.length,
      ideasRejected: ideasRejected.length,
      samplePostsRetired: samplePostsRetired.length,
      insightsCleared: clearedIds.length,
      insightsKept: keptInsights.map(row => row.platform).filter(isPlatformId),
      newslettersRemoved: newslettersRemoved.length,
      brandThemeReset,
      offeringsRetired: offeringsRetired.length,
      audiencesRemoved: audiencesRemoved.length,
      autoPublishOff
    }
  })
}
