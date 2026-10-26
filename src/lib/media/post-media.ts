import 'server-only'

import { db } from '@/db'
import {
  ideasTable,
  postDraftsTable,
  postMediaTable,
  type PostMedia
} from '@/db/schema'
import { postFullText } from '@/lib/post-text'
import { and, desc, eq } from 'drizzle-orm'
import { loadGenerationContext, loadIdeaContext } from '~/lib/ai/context'
import { recordReviewMediaSpend } from '~/lib/ai/run-accounting'
import type { VisualType } from '~/lib/ai/skills/media-brief/schema'
import { DEFAULT_BRAND_THEME } from '~/lib/brand/theme'
import { loadBrandRendering } from './brand-assets'
import { buildMediaBriefContext } from './brief-context'
import { storeMediaImages } from './image-store'
import { regenerateMediaPlan, type RegenerateMediaPlanResult } from './index'
import { REVIEWER_SEARCH_SOURCE } from './media-source'
import { mediaPlanMetadata, priorVisualsOf } from './plan-record'

/**
 * What the art director needs for one post: its idea and goal, the facts and
 * knowledge behind it, the audience, and the brand colours and logo.
 */
export async function loadMediaInputs(draft: {
  accountId: string
  ideaId: string | null
}) {
  const idea = draft.ideaId
    ? ((await db.query.ideasTable.findFirst({
        where: eq(ideasTable.id, draft.ideaId)
      })) ?? null)
    : null
  const ctx = idea
    ? await loadIdeaContext(idea)
    : await loadGenerationContext(draft.accountId, { goalIds: [] })
  return {
    idea,
    context: buildMediaBriefContext(ctx, idea),
    brand: await loadBrandRendering(
      draft.accountId,
      ctx.brand ?? DEFAULT_BRAND_THEME
    )
  }
}

export type PostMediaOutcome =
  | { status: 'created'; media: ReturnType<typeof mediaRecord> }
  | { status: 'draft_not_found' }
  | { status: 'failed'; error: string }
  | { status: 'aborted' }

/**
 * Makes a new image for a post, from its text, or from a stock query the
 * reviewer typed, optionally guided by a reference image. The first image and
 * every regeneration go through here: each one sees all the post's earlier
 * images and must differ from them.
 *
 * The new image is made before anything is written, and the abort signal is
 * checked again before saving, so a failed or stopped generation leaves the
 * post's current image in place.
 */
export async function createPostMedia(input: {
  draftId: string
  /** The identity the request is made as; the post must belong to it. */
  accountId: string
  mode?: 'ai_generated' | 'stock'
  /** Stock: searched as written. AI: direction for the new concept. */
  customPrompt?: string
  rejectionReason?: string
  /** An image the reviewer attached to guide composition and style. */
  referenceImage?: Buffer
  /** AI: the image type the reviewer picked; the art director chooses when unset. */
  visualType?: VisualType
  abortSignal?: AbortSignal
}): Promise<PostMediaOutcome> {
  const draft = await db.query.postDraftsTable.findFirst({
    where: and(
      eq(postDraftsTable.id, input.draftId),
      eq(postDraftsTable.accountId, input.accountId)
    )
  })
  if (!draft) return { status: 'draft_not_found' }

  // Every version, without the image bytes: the brief needs what each one
  // showed, not the pixels.
  const history = await db
    .select({
      id: postMediaTable.id,
      status: postMediaTable.status,
      mode: postMediaTable.mode,
      version: postMediaTable.version,
      regenerationAttempt: postMediaTable.regenerationAttempt,
      promptOrQuery: postMediaTable.promptOrQuery,
      metadata: postMediaTable.metadata,
      createdAt: postMediaTable.createdAt
    })
    .from(postMediaTable)
    .where(eq(postMediaTable.draftId, input.draftId))
    .orderBy(desc(postMediaTable.createdAt))
  const existingMedia =
    history.find(m => m.status === 'active') ?? history[0] ?? null
  const latestVersion = Math.max(0, ...history.map(m => m.version))

  const mode = input.mode || 'ai_generated'
  const customPrompt = input.customPrompt?.trim() || undefined
  // Only the reviewer's own words go to the model as their reason; the brief
  // already asks for a different concept from the earlier ones.
  const reviewerReason = input.rejectionReason?.trim() || undefined
  // A typed stock query is searched as written, so the image is the reviewer's
  // own pick; it was not scored against the post.
  const mediaSource =
    mode === 'stock' && customPrompt ? REVIEWER_SEARCH_SOURCE : undefined
  const previousVersions = priorVisualsOf(history)

  const { idea, context, brand } = await loadMediaInputs(draft)
  const ideaDirection = (idea?.suggestedMedia as { brief?: string } | null)
    ?.brief

  const excludeUrls =
    mode === 'stock'
      ? (
          await db
            .select({ imageUrl: postMediaTable.imageUrl })
            .from(postMediaTable)
            .where(
              and(
                eq(postMediaTable.draftId, input.draftId),
                eq(postMediaTable.mode, 'stock')
              )
            )
        )
          .map(r => r.imageUrl)
          .filter((u): u is string => Boolean(u))
      : []

  const mediaPlan = await regenerateMediaPlan({
    mode,
    // A typed stock query is searched as written; for a generated image the
    // reviewer's words steer the new concept. The idea's own direction only
    // seeds the first image, so a regeneration is free to leave it.
    searchQuery: mode === 'stock' ? customPrompt : undefined,
    direction:
      mode === 'ai_generated'
        ? customPrompt ||
          (previousVersions.length === 0 ? ideaDirection : undefined)
        : undefined,
    allowedTypes:
      mode === 'ai_generated' && input.visualType
        ? [input.visualType]
        : undefined,
    postText: postFullText(draft),
    context,
    brand,
    previousVersions,
    rejectionReason: reviewerReason,
    previousMediaId: existingMedia?.id,
    regenerationAttempt: existingMedia?.regenerationAttempt ?? 0,
    version: latestVersion,
    excludeUrls,
    referenceImage: mode === 'ai_generated' ? input.referenceImage : undefined,
    abortSignal: input.abortSignal
  })

  // Charged to the post's run whether or not an image came back.
  await recordReviewMediaSpend(input.draftId, mediaPlan.usage, {
    summary: `${existingMedia ? 'New' : 'First'} image (${mode}${mediaPlan.usedReference ? ', from a reference image' : ''}) (post review)`,
    error: mediaPlan.imageUrl ? null : mediaPlan.error || 'No image produced'
  })

  if (input.abortSignal?.aborted) return { status: 'aborted' }
  if (mediaPlan.mode === 'none' || !mediaPlan.imageUrl) {
    return {
      status: 'failed',
      error: mediaPlan.error || 'Could not generate a visual for this post.'
    }
  }

  const storedImages = await storeMediaImages(input.draftId, mediaPlan)

  // Supersede and insert together: never return or overwrite existing media.
  const newMedia = await db.transaction(async tx => {
    if (existingMedia) {
      await tx
        .update(postMediaTable)
        .set({
          status: 'superseded',
          rejectionReason:
            reviewerReason ||
            'User triggered media regeneration for new concept',
          updatedAt: new Date()
        })
        .where(eq(postMediaTable.id, existingMedia.id))
    }

    const [inserted] = await tx
      .insert(postMediaTable)
      .values({
        draftId: input.draftId,
        version: mediaPlan.version,
        status: 'active',
        previousMediaId: existingMedia?.id || null,
        regenerationAttempt: mediaPlan.regenerationAttempt,
        rejectionReason: reviewerReason || null,
        mode: mediaPlan.mode,
        imageUrl: storedImages.imageUrl,
        baseImageUrl: storedImages.baseImageUrl,
        altText: mediaPlan.altText || null,
        promptOrQuery: mediaPlan.promptOrQuery || null,
        metadata: mediaPlanMetadata(mediaPlan, {
          ...(mediaSource ? { source: mediaSource } : {}),
          providerRequestId: mediaPlan.providerRequestId
        })
      })
      .returning()

    if (!inserted) throw new Error('Failed to insert regenerated media record')
    return inserted
  })

  // No revalidatePath: the Posts page shows the returned media itself, and a
  // revalidation would re-render the whole page with the answer.
  return { status: 'created', media: mediaRecord(newMedia, mediaPlan, mediaSource) }
}

/** The saved image as the review screen shows it. */
function mediaRecord(
  saved: PostMedia,
  plan: RegenerateMediaPlanResult,
  source: string | undefined
) {
  return {
    id: saved.id,
    version: saved.version,
    status: saved.status,
    mode: plan.mode,
    imageUrl: plan.imageUrl,
    altText: plan.altText,
    promptOrQuery: plan.promptOrQuery,
    source,
    width: plan.width,
    height: plan.height,
    fallbackApplied: false,
    visualType: plan.visualType,
    relevanceScore: plan.relevanceScore,
    relevanceExplanation: plan.relevanceExplanation,
    issues: plan.issues,
    mediaBrief: plan.mediaBrief,
    providerRequestId: plan.providerRequestId,
    seed: plan.seed,
    regenerationAttempt: saved.regenerationAttempt,
    hasLogo: Boolean(plan.logo),
    reviewChecked: plan.review?.checked ?? false,
    usedReference: plan.usedReference ?? false
  }
}
