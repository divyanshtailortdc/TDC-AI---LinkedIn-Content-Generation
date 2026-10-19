import { db } from '@/db'
import {
  accountsTable,
  audiencesTable,
  feedbackTable,
  goalsTable,
  ideasTable,
  knowledgeDocumentsTable,
  offeringsTable,
  postDraftsTable,
  preferencesTable,
  samplePostsTable,
  voiceConfigsTable
} from '@/db/schema'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import {
  resolvePreferences,
  type GenerationContext,
  type ReviewHistory
} from './context-blocks'

export * from './context-blocks'

/**
 * Every generation stage reads its settings through this module: this file
 * loads them, ./context-blocks turns them into prompt text.
 */

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

export async function loadGenerationContext(
  accountId: string,
  options?: { goalId?: string | null }
): Promise<GenerationContext> {
  const [
    account,
    voice,
    offerings,
    audiences,
    knowledgeDocs,
    samplePosts,
    goals,
    preferences,
    history
  ] = await Promise.all([
    db.query.accountsTable.findFirst({ where: eq(accountsTable.id, accountId) }),
    db.query.voiceConfigsTable.findFirst({
      where: eq(voiceConfigsTable.accountId, accountId)
    }),
    db.query.offeringsTable.findMany({
      where: eq(offeringsTable.accountId, accountId)
    }),
    db.query.audiencesTable.findMany({
      where: eq(audiencesTable.accountId, accountId)
    }),
    db.query.knowledgeDocumentsTable.findMany({
      where: eq(knowledgeDocumentsTable.accountId, accountId)
    }),
    db.query.samplePostsTable.findMany({
      where: eq(samplePostsTable.accountId, accountId)
    }),
    db.query.goalsTable.findMany({ where: eq(goalsTable.accountId, accountId) }),
    db.query.preferencesTable.findFirst({
      where: eq(preferencesTable.accountId, accountId)
    }),
    loadReviewHistory(accountId)
  ])

  if (!account) {
    throw new Error(`Account ${accountId} not found`)
  }

  const activeGoals = (
    options?.goalId
      ? goals.filter(g => g.id === options.goalId)
      : goals.filter(g => g.isActive)
  )
    // Newest goal first, matching the goal a queued run picks by default.
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return {
    account,
    voice: voice ?? null,
    offerings: offerings.filter(o => o.isActive),
    audiences,
    knowledgeDocs,
    samplePosts: samplePosts.filter(s => s.isActive),
    goals,
    activeGoals,
    primaryGoal: activeGoals[0] ?? null,
    preferencesId: preferences?.id ?? null,
    prefs: resolvePreferences(preferences, voice),
    history
  }
}
