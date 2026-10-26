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
  postDraftsTable,
  preferencesTable,
  samplePostsTable,
  voiceConfigsTable,
  type Idea
} from '@/db/schema'
import { resolveBrandTheme, type ResolvedBrandTheme } from '@/lib/brand/theme'
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
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

/** Enough to spot a repeat or a pattern in rejections without bloating prompts. */
const HISTORY_LIMITS = { drafts: 30, ideas: 40, rejectionReasons: 8 }

async function loadReviewHistory(accountId: string): Promise<ReviewHistory> {
  const [drafts, ideas, feedback] = await Promise.all([
    db
      .select({
        hook: postDraftsTable.hook,
        originalHook: postDraftsTable.originalHook,
        body: postDraftsTable.body,
        cta: postDraftsTable.cta,
        status: postDraftsTable.status
      })
      .from(postDraftsTable)
      .where(eq(postDraftsTable.accountId, accountId))
      .orderBy(desc(postDraftsTable.createdAt))
      .limit(HISTORY_LIMITS.drafts),
    db
      .select({
        title: ideasTable.title,
        hook: ideasTable.hook,
        hookConcept: ideasTable.hookConcept,
        thesis: ideasTable.thesis,
        coreArgument: ideasTable.coreArgument,
        status: ideasTable.status,
        runId: ideasTable.runId
      })
      .from(ideasTable)
      .where(eq(ideasTable.accountId, accountId))
      .orderBy(desc(ideasTable.createdAt))
      .limit(HISTORY_LIMITS.ideas),
    db
      .select({ reasonText: feedbackTable.reasonText })
      .from(feedbackTable)
      .where(
        and(
          eq(feedbackTable.accountId, accountId),
          eq(feedbackTable.verdict, 'rejected'),
          isNotNull(feedbackTable.reasonText)
        )
      )
      .orderBy(desc(feedbackTable.createdAt))
      .limit(HISTORY_LIMITS.rejectionReasons)
  ])

  return {
    drafts,
    ideas: ideas.map(i => ({
      title: i.title || i.hook,
      hookConcept: i.hookConcept || i.hook,
      thesis: i.thesis || '',
      coreArgument: i.coreArgument || '',
      status: i.status,
      runId: i.runId
    })),
    rejectionReasons: feedback
      .map(f => f.reasonText?.trim() || '')
      .filter(Boolean)
  }
}

/**
 * `goalIds` are the goals this generation serves, in the order given; ids
 * that are not this account's are ignored. Without it, the account's active
 * goals, newest first: what settings screens and goal suggestions read.
 *
 * `lintOnly` loads just what the quality checks read (buildPostLintOptions):
 * the voice, sample posts, preferences and goals. Offerings, audiences,
 * knowledge, review history and brand are left empty, so a context loaded
 * this way must not be used to write a prompt.
 */
export async function loadGenerationContext(
  accountId: string,
  options?: { goalIds?: string[]; lintOnly?: boolean }
): Promise<GenerationContext> {
  const full = !options?.lintOnly
  const [
    account,
    voice,
    offerings,
    audiences,
    knowledgeDocs,
    samplePosts,
    goals,
    preferences,
    history,
    brand
  ] = await Promise.all([
    db.query.accountsTable.findFirst({ where: eq(accountsTable.id, accountId) }),
    db.query.voiceConfigsTable.findFirst({
      where: eq(voiceConfigsTable.accountId, accountId)
    }),
    full
      ? db.query.offeringsTable.findMany({
          where: eq(offeringsTable.accountId, accountId)
        })
      : [],
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
    full ? loadReviewHistory(accountId) : EMPTY_HISTORY,
    full ? loadBrandTheme(accountId) : resolveBrandTheme(undefined)
  ])

  if (!account) {
    throw new Error(`Account ${accountId} not found`)
  }

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
    knowledgeDocs,
    samplePosts: samplePosts.filter(s => s.isActive),
    goals,
    selectedGoals,
    primaryGoal: selectedGoals[0] ?? null,
    preferencesId: preferences?.id ?? null,
    prefs: resolvePreferences(preferences, voice),
    history,
    brand
  }
}

/**
 * The context for writing up one idea, with that idea's own goals only.
 * `lintOnly` as for loadGenerationContext.
 */
export async function loadIdeaContext(
  idea: Pick<Idea, 'id' | 'accountId' | 'goalId' | 'goalIds' | 'goalSnapshot'>,
  options?: { lintOnly?: boolean }
): Promise<GenerationContext> {
  const ctx = await loadGenerationContext(idea.accountId, {
    goalIds: idea.goalIds?.length ? idea.goalIds : idea.goalId ? [idea.goalId] : [],
    lintOnly: options?.lintOnly
  })
  return withIdeaGoal(ctx, idea)
}
