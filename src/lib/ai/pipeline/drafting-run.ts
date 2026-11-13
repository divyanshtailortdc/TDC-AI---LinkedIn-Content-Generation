import { db } from '@/db'
import {
  ideasTable,
  postCitationsTable,
  postDraftsTable,
  postMediaTable,
  postSlidesTable,
  postVariantsTable,
  runStepsTable,
  runsTable,
  type Idea,
  type NewPostDraft,
  type NewPostSlide,
  type NewRunStep
} from '@/db/schema'
import { runStatusAfterDrafting, type DraftingRunStatus } from '@/lib/run-status'
import { and, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { EMPTY_USAGE, getLanguageModel, type CallUsage } from '~/lib/ai'
import {
  runLinter,
  type LintFinding,
  type LintOptions
} from '~/lib/lint/run-linter'
import { DEFAULT_BRAND_THEME } from '@/lib/brand/theme'
import {
  createMediaPlan,
  planHasImage,
  type MediaPlanResult
} from '~/lib/media'
import { loadBrandRendering } from '~/lib/media/brand-assets'
import { buildCarouselRows, spentBy } from '~/lib/carousel/service'
import { buildMediaBriefContext } from '~/lib/media/brief-context'
import { storeMediaImages } from '~/lib/media/image-store'
import {
  FAILED_MEDIA_STATUS,
  mediaPlanMetadata,
  priorVisualsOf
} from '~/lib/media/plan-record'
import { postCharCount, postFullText } from '@/lib/post-text'
import { buildFormatLintOptions, buildPostLintOptions } from './post-lint'
import { recheckPostText } from './post-recheck'
import { getPlatform } from '@/lib/platforms'
import { isPublishingConfigured } from '@/lib/publishing/config'
import {
  cancelPendingPublications,
  hasLivePublication
} from '@/lib/publishing/publication-queries'
import { findRevision, lockPost, saveRevision } from '@/lib/post-revisions'
import {
  collectBannedWords,
  loadIdeaContext,
  platformOf,
  recentCtasOf,
  resolveLinkPlacement,
  styleFor
} from '../context'
import { refreshRunTotals } from '../run-accounting'
import { markIdeaDrafted, releaseDraftingClaim } from './drafting-claim'
import { SkillError } from '../run-skill'
import {
  writeDraft,
  type DraftGenerationResult,
  type RegenerateRequest
} from '../skills/post-drafting'
import {
  writeVariant,
  type ApprovedSibling,
  type VariantDraft
} from '../skills/variant-drafting'
import { forFormat } from '../channel-context'
import type { GenerationContext } from '../context'
import type { DraftingDb } from './drafting-claim'
import {
  carouselWording,
  cleanFormats,
  DEFAULT_FORMAT,
  FORMATS,
  canHaveImage,
  formatCharCount,
  formatOf,
  formatsToDraft,
  imageChosenFor,
  isCasualStyle,
  needsImage,
  plannedMediaFormat,
  postTexts,
  resolveMediaFormat,
  splitThread,
  suggestsCarousel,
  supportsMediaFormat,
  toPlainText,
  type FormatId,
  type MediaFormat
} from '@/lib/formats'

/** LinkedIn posts in a casual or fun style get no generated graphic. */
const linkedInIsCasual = (ctx: GenerationContext) =>
  isCasualStyle(styleFor(ctx, 'linkedin'))

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
 * Drafts an idea this caller has already claimed (see drafting-claim): the
 * drafting queue claims a whole selection up front and drafts it later.
 */
export async function draftClaimedIdeaOrRelease(
  ideaId: string
): Promise<DraftPostResult> {
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

/** Saves a settled step and brings the run's totals up to date with it. */
type RecordStep = (step: Omit<NewRunStep, 'runId'>) => Promise<void>

function stepRecorder(runId: string | null): RecordStep {
  return async step => {
    if (!runId) return
    await db.insert(runStepsTable).values({ ...step, runId })
    await refreshRunTotals(runId)
  }
}

/**
 * One post, written, checked and ready to save. Everything that needs the
 * network (the model, the image store) is done; saving is one transaction.
 */
interface PreparedPost {
  formatId: FormatId
  values: NewPostDraft & { id: string }
  alternateHooks: string[]
  /** The image and the row recording it: LinkedIn posts and picture formats (an Instagram post). */
  media: {
    plan: MediaPlanResult
    mode: 'ai_generated' | 'stock'
    stored: Awaited<ReturnType<typeof storeMediaImages>>
  } | null
  /** A carousel's slides, drawn and stored under the post's id. */
  slides: NewPostSlide[] | null
  lintErrorsCount: number
}

const blockingCount = (findings: LintFinding[]) =>
  findings.filter(f => f.severity === 'error' && !f.passed).length

/** How a post is prepared: from scratch, or as a new version of one. */
interface PrepareOptions {
  /** Rewrite an existing post, with what the reviewer wants changed. */
  regenerate?: RegenerateRequest
  /** False: text only, no image (a regenerate keeps the post's image). */
  withMedia?: boolean
  /** How this idea's posts on other platforms already open (other formats only). */
  siblingOpenings?: string[]
  /** This idea's posts the reviewer approved on other platforms (other formats only). */
  approvedSiblings?: ApprovedSibling[]
  /**
   * What goes out with the text: a rewrite keeps the post's own. Absent for
   * a new post, which plans its own (plannedMediaFormat).
   */
  mediaFormat?: MediaFormat
}

/**
 * A new post's carousel: its slides written beside its caption, drawn in
 * the brand and stored under the id the post will be saved with. Never
 * throws: null when no carousel could be made (the post then gets a single
 * image, or none), with the reason on the run step.
 */
async function makeCarousel(
  ctx: GenerationContext,
  idea: Idea,
  formatId: FormatId,
  caption: string,
  recordStep: RecordStep
): Promise<{ draftId: string; slides: NewPostSlide[] } | null> {
  const draftId = crypto.randomUUID()
  const start = Date.now()
  const label = FORMATS[formatId].label
  try {
    const built = await buildCarouselRows({
      ctx,
      idea,
      formatId,
      caption,
      brand: await loadBrandRendering(ctx.account.id, ctx.brand ?? DEFAULT_BRAND_THEME),
      draftId
    })
    await recordStep({
      stage: 'media',
      status: 'completed',
      startedAt: new Date(start),
      completedAt: new Date(),
      durationMs: Date.now() - start,
      requestSummary: `Carousel of ${built.rows.length} slides for the ${label}`,
      tokens: built.usage.totalTokens,
      costUsd: built.usage.costUsd.toFixed(4),
      responseJson: {
        mode: 'carousel',
        formatId,
        slides: built.rows.length,
        issues: built.issues,
        usage: built.usage
      }
    })
    return { draftId, slides: built.rows }
  } catch (err) {
    const usage = spentBy(err)
    const message = err instanceof Error ? err.message : 'The slides could not be made.'
    console.warn(`The carousel for the ${label} of idea ${idea.id} was not made: ${message}`)
    await recordStep({
      stage: 'media',
      status: 'failed',
      startedAt: new Date(start),
      completedAt: new Date(),
      durationMs: Date.now() - start,
      requestSummary: `Carousel for the ${label}`,
      error: message,
      tokens: usage.totalTokens,
      costUsd: usage.costUsd.toFixed(4),
      responseJson: { mode: 'carousel', formatId, usage }
    })
    return null
  }
}

/**
 * What a new or rewritten post in `formatId` is told about its idea's posts
 * in other formats: how they open, so it opens differently, and the text of
 * those the reviewer approved, so it keeps their argument and facts.
 */
async function siblingsOf(
  ideaId: string,
  formatId: FormatId
): Promise<Required<Pick<PrepareOptions, 'siblingOpenings' | 'approvedSiblings'>>> {
  const rows = await db
    .select({
      hook: postDraftsTable.hook,
      body: postDraftsTable.body,
      cta: postDraftsTable.cta,
      status: postDraftsTable.status,
      formatId: postDraftsTable.formatId
    })
    .from(postDraftsTable)
    .where(
      and(eq(postDraftsTable.ideaId, ideaId), ne(postDraftsTable.formatId, formatId))
    )
  return {
    siblingOpenings: rows.map(r => r.hook.trim()).filter(Boolean),
    approvedSiblings: rows
      .filter(r => r.status === 'approved')
      .map(r => {
        const format = formatOf(r.formatId)
        const text =
          FORMATS[format].structure === 'thread'
            ? splitThread(r.hook, r.body).map(toPlainText).join('\n---\n')
            : [r.hook, r.body, r.cta]
                .map(part => toPlainText(part).trim())
                .filter(Boolean)
                .join('\n\n')
        return { formatId: format, text }
      })
      .filter(s => s.text)
  }
}

/**
 * The LinkedIn post, written exactly as it always was: the post-drafting
 * skill, the checks with one revision pass, then the image.
 */
async function prepareLinkedInPost(
  ctx: GenerationContext,
  idea: Idea,
  recordStep: RecordStep,
  options: PrepareOptions = {}
): Promise<PreparedPost> {
  const constraints = ctx.prefs.constraints
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
      requestSummary: options.regenerate
        ? `Regenerating the LinkedIn post for "${idea.title || idea.hook}"`
        : `Drafting "${idea.title || idea.hook}"`,
      error,
      tokens: draftUsage.totalTokens,
      costUsd: draftUsage.costUsd.toFixed(4),
      responseJson: { model: handle?.modelId ?? null, usage: draftUsage }
    })

  // A carousel when the idea asks for one; the caption is written for it.
  const planned = options.mediaFormat ?? plannedMediaFormat(DEFAULT_FORMAT, idea)

  let draft: DraftGenerationResult
  try {
    const written = await writeDraft(
      { ctx, idea, mediaFormat: planned },
      undefined,
      options.regenerate
    )
    draftUsage = written.usage
    draft = written.draft
  } catch (err: any) {
    if (err instanceof SkillError) draftUsage = err.usage
    const message = err?.message || 'Draft generation failed'
    await recordDraftStep(message)
    throw new Error(message)
  }
  await recordDraftStep(null)

  // A new post whose caption tells readers to swipe gets the slides it
  // promises. A rewrite keeps the post's own media.
  let mediaFormat: MediaFormat = planned
  if (!options.regenerate && planned !== 'carousel' && carouselWording(postFullText(draft))) {
    mediaFormat = 'carousel'
  }

  // ------------------------------------------------------------------- lint
  // Only at drafting time: when a post is edited later its own ask is already
  // in the history and would be flagged as a repeat of itself.
  const recentCtas = recentCtasOf(ctx)
  const lintOptions = (d: DraftGenerationResult): LintOptions => ({
    ...buildPostLintOptions(ctx, idea, d),
    recentCtas,
    mediaFormat
  })

  const lintStart = Date.now()
  let lintFindings: LintFinding[] = runLinter(lintOptions(draft))
  let revised = false

  // --------------------------------------------------------- single revision
  const blocking = lintFindings.filter(f => f.severity === 'error' && !f.passed)
  if (blocking.length > 0) {
    try {
      const revision = await writeDraft(
        { ctx, idea, mediaFormat },
        { previous: draft, failedChecks: blocking.map(f => f.message) }
      )
      revisionUsage = revision.usage
      const revisedFindings = runLinter(lintOptions(revision.draft))
      // Only keep the rewrite if it actually improved matters.
      if (blockingCount(revisedFindings) < blocking.length) {
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
      errors: blockingCount(lintFindings),
      usage: revisionUsage
    }
  })

  const variantLimit = Math.max(1, Math.min(constraints.variants_per_post, 5))
  const prepared = (
    draftId: string,
    media: PreparedPost['media'],
    slides: NewPostSlide[] | null = null
  ): PreparedPost => ({
    formatId: DEFAULT_FORMAT,
    values: {
      id: draftId,
      accountId: ctx.account.id,
      ideaId: idea.id,
      platform: platformOf(ctx).id,
      // Set only for a carousel; every other post follows its image.
      mediaFormat: slides ? 'carousel' : undefined,
      hook: draft.hook,
      body: draft.body,
      originalHook: draft.hook,
      originalBody: draft.body,
      cta: draft.cta,
      firstComment: draft.firstComment || null,
      hashtags: draft.hashtags,
      format: idea.format || 'thought_leadership',
      formatId: DEFAULT_FORMAT,
      formatVersion: FORMATS[DEFAULT_FORMAT].version,
      charCount: postCharCount(draft),
      selfScores: draft.selfScores,
      selfFlags: draft.selfFlags,
      lintFindings,
      status: 'awaiting_review'
    },
    alternateHooks: (draft.alternateHooks || []).slice(0, variantLimit),
    media,
    slides,
    lintErrorsCount: blockingCount(lintFindings)
  })
  if (options.withMedia === false) return prepared(crypto.randomUUID(), null)
  if (mediaFormat === 'carousel') {
    const carousel = await makeCarousel(ctx, idea, DEFAULT_FORMAT, postFullText(draft), recordStep)
    if (carousel) return prepared(carousel.draftId, null, carousel.slides)
    // No slides: the post gets a single image, and its caption is checked
    // again for promising slides it no longer has.
    mediaFormat = 'image'
    lintFindings = runLinter(lintOptions(draft))
  }
  const { draftId, media } = await planPostImage(
    ctx,
    idea,
    DEFAULT_FORMAT,
    postFullText(draft),
    recordStep
  )
  return prepared(draftId, media)
}

/**
 * A new post's image: designed from its text, in the brand colours with the
 * logo (or a stock photo when the idea asks for one), and stored under the id
 * the post will be saved with. Never throws: a failure leaves the post text
 * only, with the reason recorded for the review screen.
 */
async function planPostImage(
  ctx: GenerationContext,
  idea: Idea,
  /** Its format: the image is made in that format's shape (imageShape). */
  formatId: FormatId,
  postText: string,
  recordStep: RecordStep,
  /** The post's own picture idea (an Instagram post's visualIdea). */
  visualIdea?: string
): Promise<{ draftId: string; media: NonNullable<PreparedPost['media']> }> {
  // ------------------------------------------------------------------ media
  const suggested = (idea.suggestedMedia || {}) as {
    mode?: 'ai_generated' | 'stock' | 'none'
    brief?: string
  }
  // Every post starts with an image designed from its own text, in the brand
  // colours with the logo; the reviewer can replace or remove it on the
  // review screen. An idea that asks for a stock photo gets one instead.
  const mediaMode = suggested.mode === 'stock' ? 'stock' : 'ai_generated'

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
      postText,
      shape: FORMATS[formatId].imageShape,
      // Briefed for the post's own platform, so a fun Instagram post gets a
      // playful picture, not LinkedIn's style.
      context: buildMediaBriefContext(
        { ...ctx, platform: getPlatform(FORMATS[formatId].platform) },
        idea
      ),
      brand: await loadBrandRendering(
        ctx.account.id,
        ctx.brand ?? DEFAULT_BRAND_THEME
      ),
      previousVersions,
      // The post's own picture idea when it has one, else the idea's visual
      // direction, written at ideation.
      direction: visualIdea || suggested.brief || undefined
    })
  } catch (err) {
    mediaPlan = {
      mode: 'none',
      error: err instanceof Error ? err.message : 'The image could not be made.'
    }
  }

  await recordStep({
    stage: 'media',
    status: planHasImage(mediaPlan) ? 'completed' : 'failed',
    startedAt: new Date(mediaStart),
    completedAt: new Date(),
    durationMs: Date.now() - mediaStart,
    requestSummary: `Media plan (${mediaPlan.mode})`,
    error: planHasImage(mediaPlan)
      ? null
      : mediaPlan.error || 'No image produced',
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

  // ---------------------------------------------------------------- prepare
  // The draft's id is chosen here so its image can be uploaded under it
  // before the transaction, which should not wait on the network.
  const draftId = crypto.randomUUID()
  const storedImages = await storeMediaImages(draftId, mediaPlan)

  return {
    draftId,
    media: { plan: mediaPlan, mode: mediaMode, stored: storedImages }
  }
}

/**
 * A post in any other format: the variant-drafting skill, the format's
 * checks with one revision pass. A format that is a picture with its caption
 * (an Instagram post) then gets its picture, as a LinkedIn post does; the
 * others have none, and the reviewer can add one.
 */
async function prepareFormatPost(
  ctx: GenerationContext,
  idea: Idea,
  formatId: FormatId,
  recordStep: RecordStep,
  options: PrepareOptions = {}
): Promise<PreparedPost> {
  const spec = FORMATS[formatId]
  const handle = getLanguageModel('drafting')
  const draftStart = Date.now()
  let draftUsage: CallUsage = EMPTY_USAGE
  let revisionUsage: CallUsage = EMPTY_USAGE

  const recordDraftStep = (error: string | null) =>
    recordStep({
      stage: 'drafting',
      status: error ? 'failed' : 'completed',
      startedAt: new Date(draftStart),
      completedAt: new Date(),
      durationMs: Date.now() - draftStart,
      requestSummary: `${options.regenerate ? 'Regenerating' : 'Drafting'} the ${spec.label} for "${idea.title || idea.hook}"`,
      error,
      tokens: draftUsage.totalTokens,
      costUsd: draftUsage.costUsd.toFixed(4),
      responseJson: { model: handle?.modelId ?? null, usage: draftUsage, formatId }
    })

  // What goes out with the text: the idea's carousel, or the format's
  // default. A new single-image post may become a carousel if the writer
  // finds the idea is best told as slides.
  const planned = options.mediaFormat ?? plannedMediaFormat(formatId, idea)
  const mayChooseCarousel =
    !options.regenerate && planned === 'image' && supportsMediaFormat(formatId, 'carousel')

  let draft: VariantDraft
  try {
    const written = await writeVariant(
      {
        ctx,
        idea,
        formatId,
        siblingOpenings: options.siblingOpenings,
        approvedSiblings: options.approvedSiblings,
        media: { format: planned, mayChooseCarousel }
      },
      undefined,
      options.regenerate
    )
    draftUsage = written.usage
    draft = written.draft
  } catch (err: any) {
    if (err instanceof SkillError) draftUsage = err.usage
    const message = err?.message || `The ${spec.label} could not be written`
    await recordDraftStep(message)
    throw new Error(message)
  }
  await recordDraftStep(null)

  // A carousel when the writer asked for one in its visual idea, or its
  // caption tells readers to swipe, and the format takes one. A rewrite
  // keeps the post's own media.
  const visualIdeaOf = (d: VariantDraft) => {
    const value = (d.payload as { visualIdea?: unknown } | null)?.visualIdea
    return typeof value === 'string' ? value : ''
  }
  let mediaFormat: MediaFormat = planned
  if (
    !options.regenerate &&
    planned !== 'carousel' &&
    supportsMediaFormat(formatId, 'carousel') &&
    (suggestsCarousel(visualIdeaOf(draft)) ||
      carouselWording(postTexts(formatId, draft).join('\n')))
  ) {
    mediaFormat = 'carousel'
  }

  const recentCtas = recentCtasOf(forFormat(ctx, formatId))
  const lintOptions = (d: VariantDraft): LintOptions => ({
    ...buildFormatLintOptions(ctx, formatId, idea, d),
    recentCtas,
    mediaFormat
  })

  const lintStart = Date.now()
  let lintFindings = runLinter(lintOptions(draft))
  let revised = false
  const blocking = lintFindings.filter(f => f.severity === 'error' && !f.passed)
  if (blocking.length > 0) {
    try {
      const revision = await writeVariant(
        {
          ctx,
          idea,
          formatId,
          siblingOpenings: options.siblingOpenings,
          approvedSiblings: options.approvedSiblings,
          media: { format: mediaFormat }
        },
        { previous: draft, failedChecks: blocking.map(f => f.message) }
      )
      revisionUsage = revision.usage
      const revisedFindings = runLinter(lintOptions(revision.draft))
      if (blockingCount(revisedFindings) < blocking.length) {
        draft = revision.draft
        lintFindings = revisedFindings
        revised = true
      }
    } catch (err) {
      if (err instanceof SkillError) revisionUsage = err.usage
      console.warn(`Revision of the ${spec.label} failed; keeping the first draft:`, err)
    }
  }

  await recordStep({
    stage: 'linting',
    status: 'completed',
    startedAt: new Date(lintStart),
    completedAt: new Date(),
    durationMs: Date.now() - lintStart,
    requestSummary: revised
      ? `Checked the ${spec.label} against its platform rules, then revised it once`
      : `Checked the ${spec.label} against its platform rules`,
    tokens: revisionUsage.totalTokens,
    costUsd: revisionUsage.costUsd.toFixed(4),
    responseJson: {
      formatId,
      revised,
      revisionAttempted: revisionUsage.calls > 0,
      failed: lintFindings.filter(f => !f.passed).map(f => f.rule),
      errors: blockingCount(lintFindings),
      usage: revisionUsage
    }
  })

  const caption = postTexts(formatId, draft).join('\n\n')
  // A carousel's slides, written beside the caption; without them, the
  // format's single image (and the caption checked again for slides it no
  // longer has).
  const carousel =
    mediaFormat === 'carousel' && options.withMedia !== false
      ? await makeCarousel(ctx, idea, formatId, caption, recordStep)
      : null
  if (mediaFormat === 'carousel' && options.withMedia !== false && !carousel) {
    mediaFormat = spec.withImage ? 'image' : 'text'
    lintFindings = runLinter(lintOptions(draft))
  }

  // An image when Create posts asked for one ("Add an image": an X or a
  // Facebook post too). Without that choice, only a format that is a
  // picture: an Instagram post, even in a casual or fun style, as it cannot
  // go out without one (the reviewer can swap in their own photo).
  const visualIdea = visualIdeaOf(draft)
  const image =
    (options.withMedia ?? Boolean(spec.withImage)) && !carousel
      ? await planPostImage(
          ctx,
          idea,
          formatId,
          caption,
          recordStep,
          visualIdea || undefined
        )
      : null

  return {
    formatId,
    values: {
      id: carousel?.draftId ?? image?.draftId ?? crypto.randomUUID(),
      accountId: ctx.account.id,
      ideaId: idea.id,
      // Where it goes out. Publishing (src/lib/publishing) only takes the
      // platforms it has a provider for, so this post is never sent to LinkedIn.
      platform: spec.platform,
      // Set only for a carousel; every other post follows its image.
      mediaFormat: carousel ? 'carousel' : undefined,
      hook: draft.hook,
      body: draft.body,
      originalHook: draft.hook,
      originalBody: draft.body,
      cta: draft.cta,
      firstComment: draft.firstComment || null,
      hashtags: draft.hashtags,
      format: idea.format || 'thought_leadership',
      formatId,
      formatVersion: spec.version,
      payload: draft.payload,
      charCount: formatCharCount(formatId, draft),
      selfScores: draft.selfScores,
      selfFlags: draft.selfFlags,
      lintFindings,
      status: 'awaiting_review'
    },
    alternateHooks: draft.alternateHooks.slice(0, 3),
    media: image?.media ?? null,
    slides: carousel?.slides ?? null,
    lintErrorsCount: blockingCount(lintFindings)
  }
}

type Settled = { post: PreparedPost } | { formatId: FormatId; error: string }

const settle = (formatId: FormatId, work: Promise<PreparedPost>): Promise<Settled> =>
  work.then(
    post => ({ post }),
    (err: unknown) => ({
      formatId,
      error: err instanceof Error ? err.message : String(err)
    })
  )

/**
 * Every requested format of one idea. LinkedIn runs alongside the others;
 * of the others, the first is written alone so the shared part of their
 * prompt is in the model's cache before the rest are written together.
 */
async function prepareFormats(
  ctx: GenerationContext,
  idea: Idea,
  formats: FormatId[],
  recordStep: RecordStep
): Promise<Settled[]> {
  const linkedIn = formats.includes(DEFAULT_FORMAT)
    ? settle(
        DEFAULT_FORMAT,
        // LinkedIn reads its own sample posts once others are tagged.
        prepareLinkedInPost(forFormat(ctx, DEFAULT_FORMAT), idea, recordStep, {
          // As ticked in Create posts. Without that choice, casual or fun
          // posts carry the author's own photos and videos: no generated graphic.
          withMedia: imageChosenFor(idea, DEFAULT_FORMAT) ?? !linkedInIsCasual(ctx)
        })
      )
    : null
  const others = formats.filter(f => f !== DEFAULT_FORMAT)
  const otherResults = (async () => {
    if (others.length === 0) return []
    const [first, ...rest] = others
    const firstResult = await settle(
      first!,
      prepareFormatPost(ctx, idea, first!, recordStep, {
        withMedia: imageChosenFor(idea, first!)
      })
    )
    // The rest are told how the first opens, so they open differently.
    const firstOpening = 'post' in firstResult ? [firstResult.post.values.hook] : []
    const restResults = await Promise.all(
      rest.map(f =>
        settle(
          f,
          prepareFormatPost(ctx, idea, f, recordStep, {
            siblingOpenings: firstOpening,
            withMedia: imageChosenFor(idea, f)
          })
        )
      )
    )
    return [firstResult, ...restResults]
  })()
  const [linkedInResult, rest] = await Promise.all([linkedIn, otherResults])
  return [...(linkedInResult ? [linkedInResult] : []), ...rest]
}

/** Saves prepared posts with their alternate hooks, citations and images. */
async function savePreparedPosts(
  tx: DraftingDb,
  idea: Idea,
  posts: PreparedPost[]
): Promise<void> {
  const evidence = idea.supportingEvidence || []
  for (const post of posts) {
    const [saved] = await tx
      .insert(postDraftsTable)
      .values(post.values)
      .returning({ id: postDraftsTable.id })
    if (!saved) throw new Error('Failed to create post draft record')

    if (post.alternateHooks.length > 0) {
      await tx.insert(postVariantsTable).values(
        post.alternateHooks.map(altHook => ({
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

    if (post.slides && post.slides.length > 0) {
      await tx.insert(postSlidesTable).values(post.slides)
    }

    const media = post.media
    if (!media) continue
    if (media.plan.mode !== 'none' && planHasImage(media.plan)) {
      await tx.insert(postMediaTable).values({
        draftId: saved.id,
        mode: media.plan.mode,
        imageUrl: media.stored.imageUrl,
        baseImageUrl: media.stored.baseImageUrl,
        altText: media.plan.altText || null,
        promptOrQuery: media.plan.promptOrQuery || null,
        metadata: mediaPlanMetadata(media.plan)
      })
    } else {
      // No image, but the review screen should say why rather than show the
      // post as if it never wanted one.
      await tx.insert(postMediaTable).values({
        draftId: saved.id,
        mode: media.mode,
        status: FAILED_MEDIA_STATUS,
        imageUrl: null,
        metadata: { error: media.plan.error || 'No image was produced.' }
      })
    }
  }
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
  const recordStep = stepRecorder(runId)
  const formats = formatsToDraft(idea)

  if (!getLanguageModel('drafting')) {
    const message =
      'No AI provider configured. Add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to draft posts.'
    await recordStep({
      stage: 'drafting',
      status: 'failed',
      startedAt: new Date(),
      completedAt: new Date(),
      durationMs: 0,
      requestSummary: `Drafting "${idea.title || idea.hook}"`,
      error: message,
      tokens: 0,
      costUsd: '0.0000',
      responseJson: { model: null, usage: EMPTY_USAGE }
    })
    throw new Error(message)
  }

  const results = await prepareFormats(ctx, idea, formats, recordStep)
  const posts = results.flatMap(r => ('post' in r ? [r.post] : []))
  const failures = results.flatMap(r => ('error' in r ? [r] : []))
  // Nothing written: the claim is released and the idea can be drafted again.
  if (posts.length === 0) {
    throw new Error(failures[0]?.error || 'Draft generation failed')
  }
  // Some formats failed: the others are kept, and a missing one can be added
  // from the post's page.
  for (const failure of failures) {
    console.warn(
      `The ${FORMATS[failure.formatId].label} of idea ${ideaId} was not written: ${failure.error}`
    )
  }

  // One transaction: saved piece by piece, a failure part-way left a draft
  // missing its citations while the idea stayed approved, so drafting it
  // again produced a second copy. The idea is marked drafted first: that
  // locks its row, so a second save for the same idea fails and rolls back.
  await db.transaction(async tx => {
    await markIdeaDrafted(tx, ideaId)
    await savePreparedPosts(tx, idea, posts)
  })

  // ----------------------------------------------------- run bookkeeping
  if (runId) await updateRunAfterDrafting(runId, { batchRunning: true })

  const first = posts[0]!
  return {
    draftId: first.values.id,
    charCount: first.values.charCount ?? 0,
    lintErrorsCount: first.lintErrorsCount,
    status: 'awaiting_review'
  }
}

/**
 * Writes one more format of an idea that already has posts, for "Add a
 * version" on the review screen. The idea is not claimed (it is drafted);
 * its row is locked while saving, so two requests for the same format save
 * one post, and the database refuses a second post per idea and format.
 */
export async function draftAdditionalFormat(
  accountId: string,
  ideaId: string,
  formatId: FormatId,
  /**
   * "Add an image" in the Add a version menu. A format that needs one always
   * gets one, and a video script never does. Undefined: the format's default.
   */
  withImage?: boolean
): Promise<{ draftId: string }> {
  const chosenImage =
    withImage === undefined
      ? undefined
      : canHaveImage(formatId) && (needsImage(formatId) || withImage)
  const idea = await db.query.ideasTable.findFirst({
    where: and(eq(ideasTable.id, ideaId), eq(ideasTable.accountId, accountId))
  })
  if (!idea) throw new Error('The idea behind this post no longer exists.')

  const exists = async (database: DraftingDb) =>
    (
      await database
        .select({ id: postDraftsTable.id })
        .from(postDraftsTable)
        .where(
          and(
            eq(postDraftsTable.ideaId, ideaId),
            eq(postDraftsTable.formatId, formatId)
          )
        )
        .limit(1)
    ).length > 0
  if (await exists(db)) {
    throw new Error(`This idea already has a ${FORMATS[formatId].label}.`)
  }

  const ctx = await loadIdeaContext(idea)
  const recordStep = stepRecorder(idea.runId)
  const post =
    formatId === DEFAULT_FORMAT
      ? await prepareLinkedInPost(forFormat(ctx, DEFAULT_FORMAT), idea, recordStep, {
          withMedia: chosenImage ?? !linkedInIsCasual(ctx)
        })
      : await prepareFormatPost(ctx, idea, formatId, recordStep, {
          withMedia: chosenImage,
          ...(await siblingsOf(ideaId, formatId))
        })

  await db.transaction(async tx => {
    await tx
      .select({ id: ideasTable.id })
      .from(ideasTable)
      .where(eq(ideasTable.id, ideaId))
      .for('update')
    if (await exists(tx)) {
      throw new Error(`This idea already has a ${FORMATS[formatId].label}.`)
    }
    await savePreparedPosts(tx, idea, [post])
    await tx
      .update(ideasTable)
      .set({
        targetFormats: cleanFormats([...(idea.targetFormats ?? []), formatId]),
        updatedAt: new Date()
      })
      .where(eq(ideasTable.id, ideaId))
  })

  return { draftId: post.values.id }
}

/**
 * Before a post's text is replaced (regenerate, restore): a publication still
 * waiting is called off, as when a post is rejected, and a post that is out
 * on its platform (or going out now) is left alone, since its new text would
 * no longer match what was published. `database` may be a transaction; a
 * throw rolls the cancellation back.
 */
async function stopPublishingBeforeRewrite(
  database: DraftingDb,
  draftId: string,
  what: 'rewritten' | 'restored'
): Promise<void> {
  if (!isPublishingConfigured()) return
  await cancelPendingPublications(
    database,
    { draftId },
    { message: `Cancelled because the post was ${what}.`, code: 'not_approved' }
  )
  if (await hasLivePublication(database, draftId)) {
    throw new Error(
      'This post is published on its platform, so its text can no longer change.'
    )
  }
}

/** Whether the post has an image that would go out with it. */
async function hasActiveImage(draftId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: postMediaTable.id })
    .from(postMediaTable)
    .where(
      and(
        eq(postMediaTable.draftId, draftId),
        eq(postMediaTable.status, 'active'),
        isNotNull(postMediaTable.imageUrl)
      )
    )
    .limit(1)
  return Boolean(row)
}

/**
 * Writes a new version of a post from its idea, with what the reviewer wants
 * changed ("make it shorter"), or simply another take. The text is replaced;
 * the version it replaces is kept and can be restored. The image is left
 * alone, and the post goes back to review.
 */
export async function regenerateDraft(
  accountId: string,
  draftId: string,
  instruction: string | null
): Promise<void> {
  const draft = await db.query.postDraftsTable.findFirst({
    where: and(
      eq(postDraftsTable.id, draftId),
      eq(postDraftsTable.accountId, accountId)
    )
  })
  if (!draft) throw new Error('Draft not found')
  if (draft.postedAt) {
    throw new Error(
      'This post is marked as posted. A new version would no longer match what was published.'
    )
  }
  if (!draft.ideaId) {
    throw new Error('This post has no idea behind it to write again from.')
  }
  const idea = await db.query.ideasTable.findFirst({
    where: eq(ideasTable.id, draft.ideaId)
  })
  if (!idea) throw new Error('The idea behind this post no longer exists.')
  // Checked before the model is called too, so a published post costs nothing.
  if (isPublishingConfigured() && (await hasLivePublication(db, draftId))) {
    throw new Error(
      `This post is published on ${getPlatform(draft.platform).name}, so its text can no longer change.`
    )
  }

  const formatId = formatOf(draft.formatId)
  const ctx = await loadIdeaContext(idea)
  const recordStep = stepRecorder(idea.runId)
  // The new text is written for what goes out with it now: a carousel's
  // caption as one, a single post never promising slides.
  const mediaFormat = resolveMediaFormat(formatId, draft.mediaFormat, {
    image: await hasActiveImage(draftId)
  })
  const regenerate: RegenerateRequest = {
    current: { hook: draft.hook, body: draft.body, cta: draft.cta, payload: draft.payload },
    instruction: instruction?.trim() || null
  }
  const post =
    formatId === DEFAULT_FORMAT
      ? await prepareLinkedInPost(forFormat(ctx, DEFAULT_FORMAT), idea, recordStep, {
          regenerate,
          withMedia: false,
          mediaFormat
        })
      : await prepareFormatPost(ctx, idea, formatId, recordStep, {
          regenerate,
          // A rewrite keeps the post's image, or its slides.
          withMedia: false,
          mediaFormat,
          ...(await siblingsOf(idea.id, formatId))
        })

  const v = post.values
  await db.transaction(async tx => {
    const current = await lockPost(tx, draftId)
    if (!current) throw new Error('Draft not found')
    await stopPublishingBeforeRewrite(tx, draftId, 'rewritten')
    await saveRevision(tx, current, 'regenerate', {
      instruction: regenerate.instruction
    })
    await tx
      .update(postDraftsTable)
      .set({
        hook: v.hook,
        body: v.body,
        // What the model wrote for this version, so edits made to it are
        // measured against the model's text, as for a first draft.
        originalHook: v.hook,
        originalBody: v.body,
        cta: v.cta,
        firstComment: v.firstComment,
        hashtags: v.hashtags,
        payload: v.payload ?? null,
        charCount: v.charCount,
        selfScores: v.selfScores,
        selfFlags: v.selfFlags,
        lintFindings: v.lintFindings,
        formatVersion: v.formatVersion,
        editedBody: null,
        status: 'awaiting_review',
        approvedAt: null,
        updatedAt: new Date()
      })
      .where(eq(postDraftsTable.id, draftId))
    // The alternate openings belong to the version they were written with.
    await tx
      .delete(postVariantsTable)
      .where(
        and(
          eq(postVariantsTable.draftId, draftId),
          eq(postVariantsTable.variantType, 'hook')
        )
      )
    if (post.alternateHooks.length > 0) {
      await tx.insert(postVariantsTable).values(
        post.alternateHooks.map(content => ({
          draftId,
          variantType: 'hook',
          content
        }))
      )
    }
  })
}

/**
 * Puts an earlier version of a post back. The version it replaces is kept
 * too, so a restore can itself be undone. The checks run again on the
 * restored text, and the post goes back to review.
 */
export async function restoreRevision(
  accountId: string,
  draftId: string,
  revisionId: string
): Promise<void> {
  const draft = await db.query.postDraftsTable.findFirst({
    where: and(
      eq(postDraftsTable.id, draftId),
      eq(postDraftsTable.accountId, accountId)
    )
  })
  if (!draft) throw new Error('Draft not found')
  if (draft.postedAt) {
    throw new Error(
      'This post is marked as posted. Restoring another version would no longer match what was published.'
    )
  }
  const revision = await findRevision(db, draftId, revisionId)
  if (!revision) throw new Error('That version no longer exists.')

  const text = {
    hook: revision.hook,
    body: revision.body,
    cta: revision.cta,
    firstComment: revision.firstComment,
    hashtags: revision.hashtags ?? []
  }
  const { charCount, lintFindings } = await recheckPostText(draft, {
    ...text,
    payload: revision.payload ?? null
  })

  await db.transaction(async tx => {
    const current = await lockPost(tx, draftId)
    if (!current) throw new Error('Draft not found')
    await stopPublishingBeforeRewrite(tx, draftId, 'restored')
    await saveRevision(tx, current, 'restore')
    await tx
      .update(postDraftsTable)
      .set({
        ...text,
        payload: revision.payload ?? null,
        charCount,
        lintFindings,
        editedBody: revision.body,
        status: 'awaiting_review',
        approvedAt: null,
        updatedAt: new Date()
      })
      .where(eq(postDraftsTable.id, draftId))
  })
}
