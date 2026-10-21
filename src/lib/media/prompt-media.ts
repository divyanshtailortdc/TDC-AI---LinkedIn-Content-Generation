import 'server-only'

import { db } from '@/db'
import { postDraftsTable, postMediaTable } from '@/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { addUsage, EMPTY_USAGE, type CallUsage } from '~/lib/ai/usage'
import { loadBrandTheme } from '~/lib/ai/context'
import { recordReviewMediaSpend } from '~/lib/ai/run-accounting'
import { loadBrandRendering } from './brand-assets'
import { generateCustomImage } from './index'

export type PromptMediaOutcome =
  | { status: 'created'; media: PromptMediaRecord }
  | { status: 'draft_not_found' }
  | { status: 'reference_not_found' }
  | { status: 'aborted' }

export interface PromptMediaRecord {
  id: string
  version: number
  status: string
  mode: 'ai_generated'
  imageUrl: string
  altText: string
  promptOrQuery: string
  source: 'user_prompt'
  workflow: 'generate' | 'edit'
  width: number | null
  height: number | null
  fallbackApplied: false
  seed: number
  regenerationAttempt: number
  hasLogo: boolean
}

/**
 * Generates a visual from a user-authored prompt, or edits one of the post's
 * own images with it, and makes the result the post's active media. Either way
 * the brand colours are the default palette and the logo is laid over it.
 * (An uploaded reference image goes through createPostMedia instead: it
 * guides a new image designed from the post.)
 *
 * The provider call runs before any database write, and the abort signal is
 * checked again right before saving, so a failed or stopped generation leaves the
 * currently attached media untouched. Generation failures are thrown.
 */
export async function createPromptMediaForDraft(input: {
  draftId: string
  /** The identity the request is made as; the post must belong to it. */
  accountId: string
  prompt: string
  /**
   * "Use current image": one of this post's own images, edited as it was
   * generated, before the logo went on, so the logo is never redrawn.
   */
  referenceMediaId?: string
  abortSignal?: AbortSignal
}): Promise<PromptMediaOutcome> {
  // The same check every other post action makes: a post of someone else's
  // identity is reported as not found, so nothing is generated or billed for it.
  const draft = await db.query.postDraftsTable.findFirst({
    where: and(
      eq(postDraftsTable.id, input.draftId),
      eq(postDraftsTable.accountId, input.accountId)
    ),
    columns: { id: true }
  })
  if (!draft) return { status: 'draft_not_found' }

  let editImage: string | undefined
  if (input.referenceMediaId) {
    const reference = await db.query.postMediaTable.findFirst({
      where: and(
        eq(postMediaTable.id, input.referenceMediaId),
        eq(postMediaTable.draftId, input.draftId)
      ),
      columns: { imageUrl: true, baseImageUrl: true }
    })
    const image = reference?.baseImageUrl || reference?.imageUrl
    if (!image) return { status: 'reference_not_found' }
    editImage = image
  }

  const brand = await loadBrandRendering(
    input.accountId,
    await loadBrandTheme(input.accountId)
  )

  // Every image the provider billed is charged to the post's run, including
  // ones that fail, are discarded, or finish after the reviewer cancelled.
  let spent: CallUsage = EMPTY_USAGE
  let generated: Awaited<ReturnType<typeof generateCustomImage>>
  try {
    generated = await generateCustomImage({
      prompt: input.prompt,
      editImage,
      brand,
      abortSignal: input.abortSignal,
      onUsage: usage => {
        spent = addUsage(spent, usage)
      }
    })
  } catch (err) {
    await recordReviewMediaSpend(input.draftId, spent, {
      summary: 'Image from reviewer prompt (post review)',
      error: err instanceof Error ? err.message : 'Image generation failed'
    })
    throw err
  }
  await recordReviewMediaSpend(input.draftId, spent, {
    summary: 'Image from reviewer prompt (post review)'
  })

  if (input.abortSignal?.aborted) return { status: 'aborted' }

  // Superseding and inserting together: if the insert failed on its own, the post
  // would be left with no active image at all.
  const newMedia = await db.transaction(async (tx) => {
    const existingMedia =
      (await tx.query.postMediaTable.findFirst({
        where: and(
          eq(postMediaTable.draftId, input.draftId),
          eq(postMediaTable.status, 'active')
        ),
        orderBy: desc(postMediaTable.createdAt)
      })) ||
      (await tx.query.postMediaTable.findFirst({
        where: eq(postMediaTable.draftId, input.draftId),
        orderBy: desc(postMediaTable.createdAt)
      }))

    if (existingMedia) {
      await tx
        .update(postMediaTable)
        .set({
          status: 'superseded',
          rejectionReason: 'Replaced by a user-prompted visual',
          updatedAt: new Date()
        })
        .where(eq(postMediaTable.id, existingMedia.id))
    }

    const [inserted] = await tx
      .insert(postMediaTable)
      .values({
        draftId: input.draftId,
        version: (existingMedia?.version || 0) + 1,
        status: 'active',
        previousMediaId: existingMedia?.id || null,
        regenerationAttempt: (existingMedia?.regenerationAttempt || 0) + 1,
        mode: 'ai_generated',
        imageUrl: generated.imageUrl,
        baseImageUrl: generated.baseImageUrl ?? null,
        altText: generated.altText,
        promptOrQuery: generated.promptOrQuery,
        metadata: {
          // The edited image is not copied here: it is the post's own earlier
          // version, which the history keeps.
          source: 'user_prompt',
          workflow: generated.workflow,
          modelId: generated.modelId,
          width: generated.width,
          height: generated.height,
          mediaType: generated.mediaType,
          bytes: generated.bytes,
          referenceImageCount: generated.referenceImageCount,
          seed: generated.seed,
          logo: generated.logo,
          fallbackApplied: false
        }
      })
      .returning()

    if (!inserted) throw new Error('Failed to save the generated image')
    return inserted
  })

  revalidatePath('/posts')

  return {
    status: 'created',
    media: {
      id: newMedia.id,
      version: newMedia.version,
      status: newMedia.status,
      mode: 'ai_generated',
      imageUrl: generated.imageUrl,
      altText: generated.altText,
      promptOrQuery: generated.promptOrQuery,
      source: 'user_prompt',
      workflow: generated.workflow,
      width: generated.width,
      height: generated.height,
      fallbackApplied: false,
      seed: generated.seed,
      regenerationAttempt: newMedia.regenerationAttempt,
      hasLogo: Boolean(generated.logo)
    }
  }
}
