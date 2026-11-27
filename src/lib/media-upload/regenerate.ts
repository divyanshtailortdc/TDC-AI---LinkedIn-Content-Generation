import 'server-only'

import { db } from '@/db'
import { postDraftsTable } from '@/db/schema'
import { formatOf } from '@/lib/formats'
import type { PlatformId } from '@/lib/platforms'
import { lockPost, saveRevision, type ReplacedBy } from '@/lib/post-revisions'
import { isPublishingConfigured } from '@/lib/publishing/config'
import { assertPostChangeable } from '@/lib/publishing/post-lock'
import {
  cancelPendingPublications,
  hasLivePublication
} from '@/lib/publishing/publication-queries'
import { and, eq } from 'drizzle-orm'
import { loadGenerationContext } from '~/lib/ai/context'
import { recheckPostText } from '~/lib/ai/pipeline/post-recheck'
import { rewriteMediaPost } from '~/lib/ai/skills/media-post/rewrite'
import type { MediaAnalysis } from '~/lib/ai/skills/media-post/schema'
import { withAiSpend } from '~/lib/ai/spend'
import {
  draftColumnsOf,
  mediaDraftOfPost,
  type MediaPostDraft,
  type MediaPostPart
} from './drafts'
import { uploadFormatOf, type UploadKind } from './rules'
import { storedUploadOf } from './stored-analysis'

/**
 * Regenerate on posts made from uploaded media (see the media-post skill's
 * ./rewrite): on the Create from media page, before anything is saved, and
 * on a saved post's page. Only the part asked for changes; the post's video
 * or image is never touched.
 */

/** A problem the user can act on: shown as it is. */
export class RegenerateMediaError extends Error {}

/**
 * Writes a part of a post on the Create from media page again, from the
 * analysis that page got with its posts. Nothing is stored. Charged to the
 * identity's post editing.
 */
export async function rewriteUnsavedMediaPost(
  accountId: string,
  input: {
    kind: UploadKind
    analysis: MediaAnalysis
    notes: string
    draft: Omit<MediaPostDraft, 'formatId'>
    part: MediaPostPart
    instruction?: string | null
  },
  abortSignal?: AbortSignal
): Promise<MediaPostDraft> {
  const formatId = uploadFormatOf(input.kind, input.draft.platform)
  if (!formatId) {
    throw new RegenerateMediaError(
      input.kind === 'video'
        ? 'That platform does not take videos.'
        : 'That platform does not take images.'
    )
  }
  const ctx = await loadGenerationContext(accountId)
  const { draft } = await withAiSpend({ source: 'posts', accountId }, () =>
    rewriteMediaPost({
      ctx,
      kind: input.kind,
      analysis: input.analysis,
      notes: input.notes,
      draft: { ...input.draft, formatId },
      part: input.part,
      instruction: input.instruction,
      abortSignal
    })
  )
  return draft
}

const REPLACED_BY: Record<MediaPostPart, ReplacedBy> = {
  hook: 'regenerate_hook',
  body: 'regenerate_body',
  post: 'regenerate'
}

/** The text columns a rewrite reads, to tell whether they changed meanwhile. */
const textKey = (row: {
  hook: string
  body: string
  cta: string | null
  hashtags: string[] | null
  firstComment: string | null
  payload: Record<string, unknown> | null
}) =>
  JSON.stringify([
    row.hook,
    row.body,
    row.cta ?? '',
    row.hashtags ?? [],
    row.firstComment ?? '',
    row.payload?.caption ?? null,
    row.payload?.title ?? null
  ])

/**
 * Writes a part of a saved post made from uploaded media again, and saves
 * it: its hook, its body, or the whole text. The rest of its text stays as
 * it stands, the user's edits included, and its video or image, its type
 * and what it was made from (payload.upload) are kept. The version it
 * replaces is kept under Earlier versions.
 *
 * As Regenerate on any post (regenerateDraft): new text goes back to review,
 * and a publication still waiting is called off, so nothing the user has not
 * read goes out. A post saved as a draft stays a draft. A post that is out
 * on its platform, or marked posted, is refused.
 */
export async function regenerateSavedMediaPost(
  accountId: string,
  draftId: string,
  part: MediaPostPart,
  instruction: string | null
): Promise<void> {
  const draft = await db.query.postDraftsTable.findFirst({
    where: and(
      eq(postDraftsTable.id, draftId),
      eq(postDraftsTable.accountId, accountId)
    )
  })
  if (!draft) throw new RegenerateMediaError('Draft not found')
  const upload = storedUploadOf(draft.payload)
  if (!upload) {
    throw new RegenerateMediaError(
      'This post was not made from uploaded media, so it cannot be written again from it.'
    )
  }
  // Checked before the model is called too, so a published post costs nothing.
  await assertPostChangeable(draft)

  const formatId = formatOf(draft.formatId)
  const current = mediaDraftOfPost({
    ...draft,
    platform: draft.platform as PlatformId,
    formatId
  })
  if (part !== 'post' && !current.hook.trim() && !current.body.trim()) {
    throw new RegenerateMediaError(
      'This post has no text yet. Regenerate the entire post instead.'
    )
  }

  const ctx = await loadGenerationContext(accountId)
  const { draft: next } = await withAiSpend(
    { source: 'posts', accountId, draftId },
    () =>
      rewriteMediaPost({
        ctx,
        kind: upload.kind,
        analysis: upload.analysis,
        notes: upload.notes,
        draft: current,
        part,
        instruction
      })
  )

  const columns = draftColumnsOf(next)
  // What it was made from, its analysis among it, stays with it.
  const payload = { ...(draft.payload ?? {}), ...columns.payload }
  const text = {
    hook: columns.hook,
    body: columns.body,
    cta: columns.cta,
    firstComment: columns.firstComment,
    hashtags: columns.hashtags,
    payload
  }
  const { charCount, lintFindings } = await recheckPostText(draft, text)

  await db.transaction(async tx => {
    const locked = await lockPost(tx, draftId)
    if (!locked) throw new RegenerateMediaError('Draft not found')
    // Checked on the locked row: what went out stays as it is.
    await assertPostChangeable(locked, tx)
    // Edited (or regenerated elsewhere) while this was written: the new
    // part was written against text that is gone, and would overwrite it.
    if (textKey(locked) !== textKey(draft)) {
      throw new RegenerateMediaError(
        'The post changed while the new text was being written. Try again.'
      )
    }
    if (isPublishingConfigured()) {
      await cancelPendingPublications(
        tx,
        { draftId },
        {
          message: 'Cancelled because the post was rewritten.',
          code: 'not_approved'
        }
      )
      if (await hasLivePublication(tx, draftId)) {
        throw new RegenerateMediaError(
          'This post is published on its platform, so its text can no longer change.'
        )
      }
    }
    await saveRevision(tx, locked, REPLACED_BY[part], {
      instruction: instruction?.trim() || null
    })
    const isDraft = locked.status === 'draft'
    await tx
      .update(postDraftsTable)
      .set({
        ...text,
        // What the model wrote for the parts it wrote, so edits made to them
        // are measured against its text, as for a first draft.
        originalHook: part === 'body' ? locked.originalHook : columns.hook,
        originalBody: part === 'hook' ? locked.originalBody : columns.body,
        editedBody: part === 'hook' ? locked.editedBody : null,
        charCount,
        lintFindings,
        status: isDraft ? 'draft' : 'awaiting_review',
        approvedAt: isDraft ? locked.approvedAt : null,
        updatedAt: new Date()
      })
      .where(eq(postDraftsTable.id, draftId))
  })
}
