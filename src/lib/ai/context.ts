import { db } from '@/db'
import {
  accountsTable,
  audiencesTable,
  brandThemesTable,
  feedbackTable,
  goalsTable,
  ideasTable,
  knowledgeDocumentsTable,
  offeringsTable,
  platformInsightsTable,
  postDraftsTable,
  preferencesTable,
  samplePostsTable,
  voiceConfigsTable,
  type Idea
} from '@/db/schema'
import { resolveBrandTheme, type ResolvedBrandTheme } from '@/lib/brand/theme'
import { getPlatform } from '@/lib/platforms'
import { DEFAULT_FORMAT, isPlatformId } from '@/lib/formats'
import type { PlatformInsights } from '@/lib/profile-insights/render'
import { cleanProfileInsights } from '@/lib/profile-insights/types'
import { isOldNews } from '~/lib/intel/settings'
import { loadReviewHistory } from './review-history'
import { and, desc, eq, isNotNull, ne, sql } from 'drizzle-orm'
import {
  EMPTY_HISTORY,
  resolvePreferences,
  withIdeaGoal,
  type GenerationContext,
  type ReviewHistory
} from './context-blocks'

export * from './context-blocks'

/**
 * Every generation stage reads its settings through this module: this file
 * loads them, ./context-blocks turns them into prompt text.
 */

/**
 * The brand theme without its logo file: every stage loads the context, and
 * only compositing an image needs the bytes (see ~/lib/media/brand-logo).
 */
export async function loadBrandTheme(accountId: string): Promise<ResolvedBrandTheme> {
  const t = brandThemesTable
  const [row] = await db
    .select({
      primaryColor: t.primaryColor,
      accentColor: t.accentColor,
      backgroundColor: t.backgroundColor,
      headingFont: t.headingFont,
      bodyFont: t.bodyFont,
      visualStyle: t.visualStyle,
      backgroundPattern: t.backgroundPattern,
      showLogo: t.showLogo,
      footerText: t.footerText,
      hasLogo: sql<boolean>`${t.logoImage} is not null`
    })
    .from(brandThemesTable)
    .where(eq(brandThemesTable.accountId, accountId))
    .limit(1)
  return resolveBrandTheme(row)
}

/**
 * What each platform's public profile showed, for every platform with an
 * analysis that produced (or was given) insights. A failed refresh keeps
 * the insights from before, so those are read whatever the latest status.
 */
async function loadPlatformInsights(accountId: string): Promise<PlatformInsights> {
  const rows = await db
    .select({
      platform: platformInsightsTable.platform,
      insights: platformInsightsTable.insights
    })
    .from(platformInsightsTable)
    .where(eq(platformInsightsTable.accountId, accountId))
  const out: PlatformInsights = {}
  for (const row of rows) {
    const insights = cleanProfileInsights(row.insights)
    if (insights && isPlatformId(row.platform)) out[row.platform] = insights
  }
  return out
}

/**
 * `goalIds` are the goals this generation serves, in the order given; ids
 * that are not this account's are ignored. Without it, the account's active
 * goals, newest first: what settings screens and goal suggestions read.
 *
 * `lintOnly` loads just what the quality checks read (buildPostLintOptions):
 * the voice, sample posts, offerings (figures, links and the products a post
 * may name, in the author's details), preferences and goals. Audiences,
 * knowledge, review history and brand are left empty, so a context loaded
 * this way must not be used to write a prompt.
 */
export async function loadGenerationContext(
  accountId: string,
  options?: {
    goalIds?: string[]
    lintOnly?: boolean
    /** The platform the posts are for (a post's own); the default when absent. */
    platform?: string | null
  }
): Promise<GenerationContext> {
  const platform = getPlatform(options?.platform)
  const full = !options?.lintOnly
  const [
    account,
    voice,
    offerings,
    audiences,
    knowledgeDocs,
    samplePosts,
    allGoals,
    preferences,
    history,
    brand,
    platformInsights
  ] = await Promise.all([
    db.query.accountsTable.findFirst({ where: eq(accountsTable.id, accountId) }),
    db.query.voiceConfigsTable.findFirst({
      where: eq(voiceConfigsTable.accountId, accountId)
    }),
    db.query.offeringsTable.findMany({
      where: eq(offeringsTable.accountId, accountId)
    }),
    full
      ? db.query.audiencesTable.findMany({
          where: eq(audiencesTable.accountId, accountId)
        })
      : [],
    full
      ? db.query.knowledgeDocumentsTable.findMany({
          // See ContextKnowledgeDocument.
          columns: { content: false },
          where: eq(knowledgeDocumentsTable.accountId, accountId)
        })
      : [],
    db.query.samplePostsTable.findMany({
      where: eq(samplePostsTable.accountId, accountId)
    }),
    db.query.goalsTable.findMany({ where: eq(goalsTable.accountId, accountId) }),
    db.query.preferencesTable.findFirst({
      where: eq(preferencesTable.accountId, accountId)
    }),
    full ? loadReviewHistory(db, accountId) : EMPTY_HISTORY,
    full ? loadBrandTheme(accountId) : resolveBrandTheme(undefined),
    full ? loadPlatformInsights(accountId) : {}
  ])

  if (!account) {
    throw new Error(`Account ${accountId} not found`)
  }

  // Paused goals from before the identity was switched to another company
  // are the old company's: no prompt lists them, and no post may link where
  // they pointed. Turning one back on makes it count again.
  const since = account.contextSince
  const goals = since
    ? allGoals.filter(g => g.isActive || g.createdAt >= since)
    : allGoals

  const selectedGoals = options?.goalIds
    ? options.goalIds
        .map(id => goals.find(g => g.id === id))
        .filter((g): g is (typeof goals)[number] => Boolean(g))
    : goals
        .filter(g => g.isActive)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return {
    account,
    voice: voice ?? null,
    offerings: offerings.filter(o => o.isActive),
    audiences,
    // Saved news past its age stays in the Knowledge base, but no prompt,
    // retrieval or evidence reads it (src/lib/intel/settings.ts).
    knowledgeDocs: knowledgeDocs.filter(doc => !isOldNews(doc)),
    samplePosts: samplePosts.filter(s => s.isActive),
    goals,
    selectedGoals,
    primaryGoal: selectedGoals[0] ?? null,
    preferencesId: preferences?.id ?? null,
    prefs: resolvePreferences(preferences, voice, platform),
    history,
    brand,
    platform,
    platformInsights
  }
}

/**
 * The context for writing up one idea, with that idea's own goals only.
 * `lintOnly` as for loadGenerationContext.
 */
export async function loadIdeaContext(
  idea: Pick<Idea, 'id' | 'accountId' | 'goalId' | 'goalIds' | 'goalSnapshot'>,
  options?: { lintOnly?: boolean; platform?: string | null }
): Promise<GenerationContext> {
  const ctx = await loadGenerationContext(idea.accountId, {
    goalIds: idea.goalIds?.length ? idea.goalIds : idea.goalId ? [idea.goalId] : [],
    lintOnly: options?.lintOnly,
    platform: options?.platform
  })
  return withIdeaGoal(ctx, idea)
}
