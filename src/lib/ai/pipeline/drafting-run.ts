import { db } from '@/db'
import {
  ideasTable,
  postCitationsTable,
  postDraftsTable,
  postMediaTable,
  postVariantsTable,
  runStepsTable,
  runsTable
} from '@/db/schema'
import { eq } from 'drizzle-orm'
import { EMPTY_USAGE, getLanguageModel, type CallUsage } from '~/lib/ai'
import {
  runLinter,
  type LintFinding,
  type LintOptions
} from '~/lib/lint/run-linter'
import { createMediaPlan } from '~/lib/media'
import {
  collectBannedWords,
  loadGenerationContext,
  resolveLinkPlacement
} from '../context'
import { refreshRunTotals } from '../run-accounting'
import { SkillError } from '../run-skill'
import { writeDraft, type DraftGenerationResult } from '../skills/post-drafting'

/**
 * A run's second half, per approved idea: run the post-drafting skill, lint
 * the draft against the platform rules (with one revision pass when a
 * blocking rule fails), plan the image, and save the draft for review.
 */

export interface DraftPostResult {
  draftId: string
  charCount: number
  lintErrorsCount: number
  status: string
}

export async function executeDraftingForIdea(
  ideaId: string
): Promise<DraftPostResult> {
  const idea = await db.query.ideasTable.findFirst({
    where: eq(ideasTable.id, ideaId)
  })
  if (!idea) throw new Error(`Idea ${ideaId} not found`)

  const runId = idea.runId
  const ctx = await loadGenerationContext(idea.accountId, {
    goalId: idea.goalId
  })

  const constraints = ctx.prefs.constraints
  const linkPlacement = resolveLinkPlacement(ctx.primaryGoal)

  const draftStart = Date.now()
  const [draftStep] = runId
    ? await db
        .insert(runStepsTable)
        .values({
          runId,
          stage: 'drafting',
          status: 'running',
          startedAt: new Date(),
          requestSummary: `Drafting "${idea.title || idea.hook}"`
        })
        .returning()
    : [null]

  const handle = getLanguageModel('drafting')
  if (!handle) {
    const message =
      'No AI provider configured. Add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to draft posts.'
    if (draftStep) {
      await db
        .update(runStepsTable)
        .set({ status: 'failed', completedAt: new Date(), error: message })
        .where(eq(runStepsTable.id, draftStep.id))
    }
    throw new Error(message)
  }

  // Kept apart so each lands on its own run step: the draft, the optional
  // revision pass, and the media plan are separate spend.
  let draftUsage: CallUsage = EMPTY_USAGE
  let revisionUsage: CallUsage = EMPTY_USAGE

  /** A failed draft still spent tokens; record them so run totals stay true. */
  async function failDraftStep(message: string) {
    if (!draftStep || !runId) return
    await db
      .update(runStepsTable)
      .set({
        status: 'failed',
        completedAt: new Date(),
        error: message,
        tokens: draftUsage.totalTokens,
        costUsd: draftUsage.costUsd.toFixed(4),
        responseJson: { model: handle!.modelId, usage: draftUsage }
      })
      .where(eq(runStepsTable.id, draftStep.id))
    await refreshRunTotals(runId)
  }

  let draft: DraftGenerationResult
  try {
    const written = await writeDraft({ ctx, idea })
    draftUsage = written.usage
    draft = written.draft
  } catch (err: any) {
    if (err instanceof SkillError) draftUsage = err.usage
    const message = err?.message || 'Draft generation failed'
    await failDraftStep(message)
    throw new Error(message)
  }

  if (draftStep) {
    await db
      .update(runStepsTable)
      .set({
        status: 'completed',
        completedAt: new Date(),
        durationMs: Date.now() - draftStart,
        tokens: draftUsage.totalTokens,
        costUsd: draftUsage.costUsd.toFixed(4),
        responseJson: {
          model: handle.modelId,
          usage: draftUsage
        }
      })
      .where(eq(runStepsTable.id, draftStep.id))
  }

  // ------------------------------------------------------------------- lint
  const evidence = idea.supportingEvidence || []
  const lintOptions = (d: DraftGenerationResult): LintOptions => ({
    hook: d.hook,
    body: d.body,
    cta: d.cta,
    firstComment: d.firstComment,
    hashtags: d.hashtags,
    linkPlacement,
    bannedWords: collectBannedWords(ctx),
    bannedTopics: ctx.prefs.guardrails.banned_topics,
    maxChars: constraints.max_chars,
    hookMaxChars: constraints.hook_max_chars,
    hashtagRange: constraints.hashtags,
    emojiLevel: constraints.emoji_level,
    ctaRequired: constraints.cta_required,
    citationsCount: evidence.length,
    minCitations: ctx.prefs.research.min_citations_per_post
  })

  const lintStart = Date.now()
  let lintFindings: LintFinding[] = runLinter(lintOptions(draft))
  let revised = false

  // --------------------------------------------------------- single revision
  const blocking = lintFindings.filter(f => f.severity === 'error' && !f.passed)
  if (blocking.length > 0) {
    try {
      const revision = await writeDraft(
        { ctx, idea },
        { previous: draft, failedChecks: blocking.map(f => f.message) }
      )
      revisionUsage = revision.usage
      const revisedFindings = runLinter(lintOptions(revision.draft))
      const revisedBlocking = revisedFindings.filter(
        f => f.severity === 'error' && !f.passed
      )
      // Only keep the rewrite if it actually improved matters.
      if (revisedBlocking.length < blocking.length) {
        draft = revision.draft
        lintFindings = revisedFindings
        revised = true
      }
    } catch (err) {
      // The revision call is a full second draft; a failed one still cost.
      if (err instanceof SkillError) revisionUsage = err.usage
      console.warn('Revision pass failed; keeping the original draft:', err)
    }
  }

  if (runId) {
    await db.insert(runStepsTable).values({
      runId,
      stage: 'linting',
      status: 'completed',
      startedAt: new Date(lintStart),
      completedAt: new Date(),
      durationMs: Date.now() - lintStart,
      requestSummary: revised
        ? 'Checked platform rules, then revised once to clear blocking findings'
        : 'Checked platform rules, character limits, guardrails and citations',
      tokens: revisionUsage.totalTokens,
      costUsd: revisionUsage.costUsd.toFixed(4),
      responseJson: {
        revised,
        // The revision pass is a full second draft call; its cost belongs here.
        revisionAttempted: revisionUsage.calls > 0,
        failed: lintFindings.filter(f => !f.passed).map(f => f.rule),
        errors: lintFindings.filter(f => f.severity === 'error' && !f.passed)
          .length,
        usage: revisionUsage
      }
    })
  }

  // ------------------------------------------------------------------ media
  const suggested = (idea.suggestedMedia || {}) as {
    mode?: 'ai_generated' | 'stock' | 'none'
    brief?: string
  }
  // The idea carries the human's per-idea override from the approval gate;
  // otherwise no image, and one can be added from the review screen.
  const mediaMode = suggested.mode || 'none'
  const fullPostText = [draft.hook, draft.body, draft.cta]
    .filter(Boolean)
    .join('\n\n')

  const mediaStart = Date.now()
  const mediaPlan = await createMediaPlan({
    mode: mediaMode,
    brief: suggested.brief || null,
    topic: idea.pillar || idea.title,
    hook: draft.hook,
    postText: fullPostText,
    thesis: idea.thesis || idea.coreArgument || idea.title,
    coreArgument: idea.coreArgument || undefined,
    evidence,
    accountName: ctx.account.name
  })

  if (runId && mediaMode !== 'none') {
    await db.insert(runStepsTable).values({
      runId,
      stage: 'media',
      status: mediaPlan.imageUrl ? 'completed' : 'failed',
      startedAt: new Date(mediaStart),
      completedAt: new Date(),
      durationMs: Date.now() - mediaStart,
      requestSummary: `Media plan (${mediaPlan.mode})`,
      error: mediaPlan.imageUrl ? null : mediaPlan.error || 'No image produced',
      tokens: mediaPlan.usage?.totalTokens ?? 0,
      costUsd: (mediaPlan.usage?.costUsd ?? 0).toFixed(4),
      responseJson: {
        mode: mediaPlan.mode,
        fallbackApplied: mediaPlan.fallbackApplied || false,
        relevanceScore: mediaPlan.relevanceScore,
        concept: mediaPlan.mediaBrief?.primaryConcept,
        imageAttempts: mediaPlan.imageAttempts ?? 0,
        usage: mediaPlan.usage ?? EMPTY_USAGE
      }
    })
  }

  // ----------------------------------------------------------------- persist
  const charCount = fullPostText.length

  const [saved] = await db
    .insert(postDraftsTable)
    .values({
      accountId: ctx.account.id,
      ideaId,
      hook: draft.hook,
      body: draft.body,
      cta: draft.cta,
      firstComment: draft.firstComment || null,
      hashtags: draft.hashtags,
      format: idea.format || 'thought_leadership',
      charCount,
      selfScores: draft.selfScores,
      selfFlags: draft.selfFlags,
      lintFindings,
      status: 'awaiting_review'
    })
    .returning()

  if (!saved) throw new Error('Failed to create post draft record')

  const variantLimit = Math.max(1, Math.min(constraints.variants_per_post, 5))
  for (const altHook of (draft.alternateHooks || []).slice(0, variantLimit)) {
    await db.insert(postVariantsTable).values({
      draftId: saved.id,
      variantType: 'hook',
      content: altHook
    })
  }

  for (const ev of evidence) {
    await db.insert(postCitationsTable).values({
      draftId: saved.id,
      claim: ev.claim,
      quote: ev.quote || null,
      sourceUrl: ev.sourceUrl || null,
      sourceTitle: ev.sourceTitle || null
    })
  }

  if (mediaPlan.mode !== 'none' && mediaPlan.imageUrl) {
    await db.insert(postMediaTable).values({
      draftId: saved.id,
      mode: mediaPlan.mode,
      imageUrl: mediaPlan.imageUrl,
      altText: mediaPlan.altText || null,
      promptOrQuery: mediaPlan.promptOrQuery || null,
      metadata: {
        sourcePageUrl: mediaPlan.sourcePageUrl,
        fallbackApplied: mediaPlan.fallbackApplied || false,
        relevanceScore: mediaPlan.relevanceScore,
        relevanceExplanation: mediaPlan.relevanceExplanation,
        mediaBrief: mediaPlan.mediaBrief
      }
    })
  }

  await db
    .update(ideasTable)
    .set({ status: 'drafted', updatedAt: new Date() })
    .where(eq(ideasTable.id, ideaId))

  // ----------------------------------------------------- run bookkeeping
  if (runId) {
    const runIdeas = await db.query.ideasTable.findMany({
      where: eq(ideasTable.runId, runId)
    })
    // A run is finished once nothing is still approved and waiting to be drafted.
    const pending = runIdeas.some(i => i.status === 'approved')

    await db
      .update(runsTable)
      .set({
        status: pending ? 'drafting' : 'completed',
        currentStep: pending ? 2 : 3,
        totalSteps: 3
      })
      .where(eq(runsTable.id, runId))

    await refreshRunTotals(runId)
  }

  return {
    draftId: saved.id,
    charCount,
    lintErrorsCount: lintFindings.filter(
      f => f.severity === 'error' && !f.passed
    ).length,
    status: 'awaiting_review'
  }
}
