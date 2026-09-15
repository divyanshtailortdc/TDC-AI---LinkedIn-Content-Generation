import 'server-only'

import { db } from '@/db'
import { postDraftsTable, postMediaTable } from '@/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { generateCustomImage } from './index'

export type PromptMediaOutcome =
  | { status: 'created'; media: PromptMediaRecord }
  | { status: 'draft_not_found' }
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
}

/**
 * Generates a visual from a user-authored prompt (plus optional reference images)
 * and makes it the post's active media.
 *
 * The provider call runs before any database write, and the abort signal is
 * checked again right before saving, so a failed or stopped generation leaves the
 * currently attached media untouched. Generation failures are thrown.
 */
export async function createPromptMediaForDraft(input: {
  draftId: string
  prompt: string
  referenceImages?: string[]
  abortSignal?: AbortSignal
}): Promise<PromptMediaOutcome> {
  const draft = await db.query.postDraftsTable.findFirst({
    where: eq(postDraftsTable.id, input.draftId),
    columns: { id: true }
  })
  if (!draft) return { status: 'draft_not_found' }

  const generated = await generateCustomImage({
    prompt: input.prompt,
    referenceImages: input.referenceImages,
    abortSignal: input.abortSignal
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
        altText: generated.altText,
        promptOrQuery: generated.promptOrQuery,
        metadata: {
          // Reference images are intentionally not persisted — they can be several
          // megabytes of base64 and are only needed for the single generation call.
          source: 'user_prompt',
          workflow: generated.workflow,
          modelId: generated.modelId,
          width: generated.width,
          height: generated.height,
          mediaType: generated.mediaType,
          bytes: generated.bytes,
          referenceImageCount: generated.referenceImageCount,
          seed: generated.seed,
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
      regenerationAttempt: newMedia.regenerationAttempt
    }
  }
}
