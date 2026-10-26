import { db } from '@/db'
import {
  ideasTable,
  postCitationsTable,
  postDraftsTable,
  postMediaTable,
  postVariantsTable,
  runStepsTable,
  runsTable,
  type NewRunStep
} from '@/db/schema'
import { runStatusAfterDrafting, type DraftingRunStatus } from '@/lib/run-status'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { EMPTY_USAGE, getLanguageModel, type CallUsage } from '~/lib/ai'
import {
  runLinter,
  type LintFinding,
  type LintOptions
} from '~/lib/lint/run-linter'
import { DEFAULT_BRAND_THEME } from '@/lib/brand/theme'
import { createMediaPlan, type MediaPlanResult } from '~/lib/media'
import { loadBrandRendering } from '~/lib/media/brand-assets'
import { buildMediaBriefContext } from '~/lib/media/brief-context'
import { storeMediaImages } from '~/lib/media/image-store'
import {
  FAILED_MEDIA_STATUS,
  mediaPlanMetadata,
  priorVisualsOf
} from '~/lib/media/plan-record'
import { postCharCount, postFullText } from '@/lib/post-text'
import { buildPostLintOptions } from './post-lint'
import {
  collectBannedWords,
  loadIdeaContext,
  recentCtasOf,
  resolveLinkPlacement
} from '../context'
import { refreshRunTotals } from '../run-accounting'
import {
  claimIdeaForDrafting,
  markIdeaDrafted,
  releaseDraftingClaim
} from './drafting-claim'
import { SkillError } from '../run-skill'
import { writeDraft, type DraftGenerationResult } from '../skills/post-drafting'
import { collectFigureSources } from '../skills/post-drafting/guard'

/**
 * A run's second half, per approved idea: run the post-drafting skill, lint
 * the draft against the platform rules (with one revision pass when a
 * blocking rule fails), plan the image, and save the draft for review.
 *
 * Each step is recorded once its work settles, never opened as "running"
 * first, so a crash cannot leave one stuck; its spend reaches the run's totals
 * straight away. The draft and everything hanging off it save in one go.
 *
 * An idea is drafted once: it is claimed before any model call and only the
 * caller holding the claim drafts it (see drafting-claim.ts).
 */

export interface DraftPostResult {
  draftId: string
  charCount: number
  lintErrorsCount: number
  status: string
}

/**
 * Drafts an approved idea. Returns null, without drafting, when the idea is
 * not approved: already drafted, being drafted by another request (a retry or
 * a second click), rejected, or gone.
 */
export async function executeDraftingForIdea(
  ideaId: string
): Promise<DraftPostResult | null> {
  if (!(await claimIdeaForDrafting(db, ideaId))) return null
  try {
    return await draftClaimedIdea(ideaId)
  } catch (err) {
    // Hands the idea back so it can be drafted again. After the post is saved
    // the idea is drafted and this changes nothing.
    await releaseDraftingClaim(db, ideaId).catch(releaseErr =>
      console.error(`Could not release drafting claim on ${ideaId}:`, releaseErr)
    )
    throw err
  }
}

const STEP_FOR_STATUS = {
  awaiting_idea_approval: 2,
  drafting: 2,
  completed: 3
} as const

/**
 * Sets the run's status from where its ideas now stand. A failed run keeps
 * its status: only the drafting-time statuses are moved.
 */
async function updateRunAfterDrafting(
  runId: string,
  options: {
    batchRunning: boolean
    /** Run statuses this may overwrite; the default is all drafting-time ones. */
    onlyFrom?: DraftingRunStatus[]
  }
) {
  const runIdeas = await db
    .select({ status: ideasTable.status })
    .from(ideasTable)
    .where(eq(ideasTable.runId, runId))
  const status = runStatusAfterDrafting(runIdeas.map(i => i.status), {
    batchRunning: options.batchRunning
  })
  await db
    .update(runsTable)
    .set({
      status,
      currentStep: STEP_FOR_STATUS[status],
      totalSteps: 3
    })
    .where(
      and(
        eq(runsTable.id, runId),
        inArray(
          runsTable.status,
          options.onlyFrom ?? ['drafting', 'awaiting_idea_approval', 'completed']
        )
      )
    )
}

/**
 * Called when a drafting request ends, successfully or not. Ideas it did not
 * get to (a failure part-way, or a claim it released) are back to approved, so
 * the run returns to awaiting approval instead of staying on "drafting".
 */
export async function settleRunAfterDrafting(runId: string) {
  await updateRunAfterDrafting(runId, { batchRunning: false })
}

/**
 * Called when an idea of the run is approved or rejected. A run that is
 * "drafting" is left alone: a batch is working through its ideas, and between
 * one idea finishing and the next being claimed none reads "drafting", so
 * settling then would show "Create posts" mid-batch. The batch settles the run
 * itself when it ends. The status check is part of the update, so a batch that
 * starts meanwhile is not overwritten either.
 */
export async function settleRunAfterIdeaDecision(runId: string) {
  await updateRunAfterDrafting(runId, {
    batchRunning: false,
    onlyFrom: ['awaiting_idea_approval', 'completed']
  })
}

async function draftClaimedIdea(ideaId: string): Promise<DraftPostResult> {
  const idea = await db.query.ideasTable.findFirst({
    where: eq(ideasTable.id, ideaId)
  })
  if (!idea) throw new Error(`Idea ${ideaId} not found`)

  const runId = idea.runId
  // The idea's own goal and no other, so the post lands the message the idea
  // was made for.
  const ctx = await loadIdeaContext(idea)

  const constraints = ctx.prefs.constraints
  const linkPlacement = resolveLinkPlacement(ctx.primaryGoal)

  /** Saves a settled step and brings the run's totals up to date with it. */
  async function recordStep(step: Omit<NewRunStep, 'runId'>) {
    if (!runId) return
    await db.insert(runStepsTable).values({ ...step, runId })
    await refreshRunTotals(runId)
  }

  const handle = getLanguageModel('drafting')
  const draftStart = Date.now()

  // Kept apart so each lands on its own run step: the draft, the optional
  // revision pass, and the media plan are separate spend.
  let draftUsage: CallUsage = EMPTY_USAGE
  let revisionUsage: CallUsage = EMPTY_USAGE

  /** A failed draft still spent tokens; recording them keeps run totals true. */
  const recordDraftStep = (error: string | null) =>
    recordStep({
      stage: 'drafting',
      status: error ? 'failed' : 'completed',
      startedAt: new Date(draftStart),
      completedAt: new Date(),
      durationMs: Date.now() - draftStart,
      requestSummary: `Drafting "${idea.title || idea.hook}"`,
      error,
      tokens: draftUsage.totalTokens,
      costUsd: draftUsage.costUsd.toFixed(4),
      responseJson: { model: handle?.modelId ?? null, usage: draftUsage }
    })

  if (!handle) {
    const message =
      'No AI provider configured. Add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to draft posts.'
    await recordDraftStep(message)
    throw new Error(message)
  }

  let draft: DraftGenerationResult
  try {
    const written = await writeDraft({ ctx, idea })
    draftUsage = written.usage
    draft = written.draft
  } catch (err: any) {
    if (err instanceof SkillError) draftUsage = err.usage
    const message = err?.message || 'Draft generation failed'
    await recordDraftStep(message)
    throw new Error(message)
  }
  await recordDraftStep(null)

  // ------------------------------------------------------------------- lint
  const evidence = idea.supportingEvidence || []
  // Only at drafting time: when a post is edited later its own ask is already
  // in the history and would be flagged as a repeat of itself.
  const recentCtas = recentCtasOf(ctx)
  const lintOptions = (d: DraftGenerationResult): LintOptions => ({
    ...buildPostLintOptions(ctx, idea, d),
    recentCtas
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

  await recordStep({
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

  // ------------------------------------------------------------------ media
  const suggested = (idea.suggestedMedia || {}) as {
    mode?: 'ai_generated' | 'stock' | 'none'
    brief?: string
  }
  // Every post starts with an image designed from its own text, in the brand
  // colours with the logo; the reviewer can replace or remove it on the
  // review screen. An idea that asks for a stock photo gets one instead.
  const mediaMode = suggested.mode === 'stock' ? 'stock' : 'ai_generated'
  const fullPostText = postFullText(draft)

  let previousVersions = undefined
  if (mediaMode === 'ai_generated') {
    try {
      const recentMediaRows = await db
        .select({
          status: postMediaTable.status,
          version: postMediaTable.version,
          promptOrQuery: postMediaTable.promptOrQuery,
          metadata: postMediaTable.metadata
        })
        .from(postMediaTable)
        .innerJoin(
          postDraftsTable,
          eq(postMediaTable.draftId, postDraftsTable.id)
        )
        .where(
          and(
            eq(postDraftsTable.accountId, ctx.account.id),
            eq(postMediaTable.status, 'active')
          )
        )
        .orderBy(desc(postMediaTable.createdAt))
        .limit(4)
      previousVersions = priorVisualsOf(recentMediaRows)
    } catch {
      // Best-effort history lookup
    }
  }

  const mediaStart = Date.now()
  // A post is never lost to its image: a failure leaves it text only, with
  // the reason shown on the review screen.
  let mediaPlan: MediaPlanResult
  try {
    mediaPlan = await createMediaPlan({
      mode: mediaMode,
      postText: fullPostText,
      context: buildMediaBriefContext(ctx, idea),
      brand: await loadBrandRendering(
        ctx.account.id,
        ctx.brand ?? DEFAULT_BRAND_THEME
      ),
      previousVersions,
      // The idea's own visual direction, written at ideation.
      direction: suggested.brief || undefined
    })
  } catch (err) {
    mediaPlan = {
      mode: 'none',
      error: err instanceof Error ? err.message : 'The image could not be made.'
    }
  }

  await recordStep({
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
      relevanceScore: mediaPlan.relevanceScore,
      concept: mediaPlan.mediaBrief?.primaryConcept,
      imageAttempts: mediaPlan.imageAttempts ?? 0,
      model: mediaPlan.modelId,
      review: mediaPlan.review,
      logo: mediaPlan.logo,
      usage: mediaPlan.usage ?? EMPTY_USAGE
    }
  })

  // ----------------------------------------------------------------- persist
  const charCount = postCharCount(draft)

  const variantLimit = Math.max(1, Math.min(constraints.variants_per_post, 5))
  const alternateHooks = (draft.alternateHooks || []).slice(0, variantLimit)

  // The draft's id is chosen here so its image can be uploaded under it
  // before the transaction, which should not wait on the network.
  const draftId = crypto.randomUUID()
  const storedImages = await storeMediaImages(draftId, mediaPlan)

  // One transaction: saved piece by piece, a failure part-way left a draft
  // missing its citations while the idea stayed approved, so drafting it
  // again produced a second copy. The idea is marked drafted first: that
  // locks its row, so a second save for the same idea fails and rolls back.
  const saved = await db.transaction(async tx => {
    await markIdeaDrafted(tx, ideaId)

    const [saved] = await tx
      .insert(postDraftsTable)
      .values({
        id: draftId,
        accountId: ctx.account.id,
        ideaId,
        hook: draft.hook,
        body: draft.body,
        originalHook: draft.hook,
        originalBody: draft.body,
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

    if (alternateHooks.length > 0) {
      await tx.insert(postVariantsTable).values(
        alternateHooks.map(altHook => ({
          draftId: saved.id,
          variantType: 'hook',
          content: altHook
        }))
      )
    }

    if (evidence.length > 0) {
      await tx.insert(postCitationsTable).values(
        evidence.map(ev => ({
          draftId: saved.id,
          claim: ev.claim,
          quote: ev.quote || null,
          sourceUrl: ev.sourceUrl || null,
          sourceTitle: ev.sourceTitle || null
        }))
      )
    }

    if (mediaPlan.mode !== 'none' && mediaPlan.imageUrl) {
      await tx.insert(postMediaTable).values({
        draftId: saved.id,
        mode: mediaPlan.mode,
        imageUrl: storedImages.imageUrl,
        baseImageUrl: storedImages.baseImageUrl,
        altText: mediaPlan.altText || null,
        promptOrQuery: mediaPlan.promptOrQuery || null,
        metadata: mediaPlanMetadata(mediaPlan)
      })
    } else {
      // No image, but the review screen should say why rather than show the
      // post as if it never wanted one.
      await tx.insert(postMediaTable).values({
        draftId: saved.id,
        mode: mediaMode,
        status: FAILED_MEDIA_STATUS,
        imageUrl: null,
        metadata: { error: mediaPlan.error || 'No image was produced.' }
      })
    }

    return saved
  })

  // ----------------------------------------------------- run bookkeeping
  if (runId) await updateRunAfterDrafting(runId, { batchRunning: true })

  return {
    draftId: saved.id,
    charCount,
    lintErrorsCount: lintFindings.filter(
      f => f.severity === 'error' && !f.passed
    ).length,
    status: 'awaiting_review'
  }
}
