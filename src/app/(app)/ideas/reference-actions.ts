'use server'

import { db } from '@/db'
import {
  canHaveImage,
  cleanFormats,
  FORMATS,
  isCreatableFormat,
  supportsMediaFormat,
  type FormatId
} from '@/lib/formats'
import { loadChannels } from '@/lib/channels'
import { requireIdentityId } from '@/lib/identity'
import { requireUser } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { enqueueDrafting } from '~/jobs/drafting-queue'
import { claimDraftSelection } from '~/lib/ai/pipeline/draft-selection'
import { settleRunAfterDrafting } from '~/lib/ai/pipeline/drafting-run'
import { SkillError } from '~/lib/ai/run-skill'
import { EmptyReferenceIdeaError } from '~/lib/ai/skills/reference-ideation/guard'
import { withAiSpend } from '~/lib/ai/spend'
import { createIdeaFromReference } from '~/lib/reference-post/create'
import { parseReferenceLink, ReferenceLinkError } from '~/lib/reference-post/link'
import { isFetchableThumbnail } from '~/lib/reference-post/oembed'
import { readReference, ReferenceReadError } from '~/lib/reference-post/read'
import {
  REFERENCE_KINDS,
  REFERENCE_TEXT_MAX,
  REFERENCE_TEXT_MIN,
  SIMILAR_POST_ENABLED,
  type ReferenceKind,
  type ReferencePost
} from '~/lib/reference-post/types'

/**
 * "A post like this one": the user shares a public post's link, checks what
 * could be read of it (or pastes its text), picks where the new post goes,
 * and a post like it is written for the active identity.
 */

/** Switched off for now (SIMILAR_POST_ENABLED): both actions say so. */
const NOT_AVAILABLE = 'Creating a post from a link is not available right now.'

/** What the dialog shows once a link has been looked at. */
export type ReadReferenceResult =
  | { success: true; reference: ReferencePost }
  /** The link is fine but its words could not be read: the user pastes them. */
  | {
      success: false
      needsText: true
      error: string
      reference: Pick<ReferencePost, 'url' | 'source' | 'kind'>
    }
  | { success: false; needsText?: false; error: string }

/** Reads a shared link: nothing is saved and no AI is used, only searches and public embeds. */
export async function readReferenceAction(rawUrl: string): Promise<ReadReferenceResult> {
  await requireUser()
  if (!SIMILAR_POST_ENABLED) return { success: false, error: NOT_AVAILABLE }
  try {
    await requireIdentityId()
    const link = parseReferenceLink(typeof rawUrl === 'string' ? rawUrl : '')
    try {
      return { success: true, reference: await readReference(link) }
    } catch (err) {
      if (!(err instanceof ReferenceReadError)) console.error('Reading a shared link failed:', err)
      return {
        success: false,
        needsText: true,
        error:
          err instanceof ReferenceReadError
            ? err.message
            : 'This post could not be read just now. Paste its text below and carry on.',
        reference: { url: link.url, source: link.source, kind: link.kind }
      }
    }
  } catch (err) {
    if (err instanceof ReferenceLinkError) return { success: false, error: err.message }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'This link could not be read.'
    }
  }
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/**
 * The shared post as the dialog sends it back. The browser's copy is
 * trusted only as far as the user could have typed it anyway (its text,
 * author and title); where it points, and what is fetched for the model,
 * are worked out again here.
 */
function referenceFrom(raw: unknown): ReferencePost {
  const input = (raw ?? {}) as Record<string, unknown>
  const link = parseReferenceLink(text(input.url, 2000))
  const body = text(input.text, REFERENCE_TEXT_MAX)
  if (body.length < REFERENCE_TEXT_MIN) {
    throw new ReferenceLinkError(
      'Add the post’s text (at least a sentence), so there is something to write a post like it from.'
    )
  }
  const kind = REFERENCE_KINDS.includes(input.kind as ReferenceKind)
    ? (input.kind as ReferenceKind)
    : link.kind
  const imageUrl = text(input.imageUrl, 2000)
  const author = text(input.author, 200)
  const title = text(input.title, 300)
  const via = input.via === 'oembed' || input.via === 'search' || input.via === 'page' ? input.via : 'pasted'
  return {
    url: link.url,
    source: link.source,
    // An article stays an article; anything else may be what was read (a carousel).
    kind: link.kind === 'article' ? 'article' : kind,
    ...(author ? { author } : {}),
    ...(title ? { title } : {}),
    text: body,
    partial: input.partial === true,
    via,
    ...(isFetchableThumbnail(imageUrl) ? { imageUrl } : {})
  }
}

/**
 * Makes an idea from the shared post (one AI call, while the dialog waits),
 * then queues its posts like Create posts does. Answers once the posts are
 * being written; the Ideas page follows them as it follows any drafting.
 */
export async function createSimilarPostAction(input: {
  reference: unknown
  formats: string[]
  imageFormats: string[]
  /** Of those, the ones set to "Carousel"; the rest get a single image. */
  carouselFormats?: string[]
}): Promise<{ success: true; ideaId: string; title: string } | { success: false; error: string }> {
  const user = await requireUser()
  if (!SIMILAR_POST_ENABLED) return { success: false, error: NOT_AVAILABLE }
  try {
    const accountId = await requireIdentityId()
    const reference = referenceFrom(input?.reference)
    const { enabledFormats } = await loadChannels(accountId)
    const formats = cleanFormats(input?.formats).filter(isCreatableFormat)
    if (formats.length === 0) {
      return { success: false, error: 'Choose at least one platform to write the post for.' }
    }
    const off = formats.find(f => !enabledFormats.includes(f))
    if (off) {
      return {
        success: false,
        error: `Turn on ${FORMATS[off].label}s under Identity → Preferences first.`
      }
    }
    const imageFormats = cleanFormats(input?.imageFormats).filter(
      (f): f is FormatId => formats.includes(f) && canHaveImage(f)
    )
    const carouselFormats = cleanFormats(input?.carouselFormats).filter(
      f => imageFormats.includes(f) && supportsMediaFormat(f, 'carousel')
    )

    const { ideaId, title } = await withAiSpend(
      { source: 'posts', accountId, userId: user.id },
      () =>
        createIdeaFromReference({
          accountId,
          reference,
          formats,
          imageFormats,
          carouselFormats
        })
    )

    const outcome = await claimDraftSelection(
      db,
      { accountId, ideaIds: [ideaId] },
      { settleRun: settleRunAfterDrafting }
    )
    // After the response, and kept alive until drafted, as Create posts does.
    after(() =>
      enqueueDrafting(outcome.claimed).catch(err => console.error('Drafting failed:', err))
    )
    revalidatePath('/ideas')
    if (outcome.queued === 0) {
      return {
        success: false,
        error: 'The idea was saved, but its post could not be started. Create it from Ideas.'
      }
    }
    return { success: true, ideaId, title }
  } catch (err) {
    if (err instanceof ReferenceLinkError || err instanceof EmptyReferenceIdeaError) {
      return { success: false, error: err.message }
    }
    if (err instanceof SkillError) {
      if (err.reason === 'spend_limit') return { success: false, error: err.message }
      if (err.reason === 'not_configured') {
        return {
          success: false,
          error: 'AI is not configured. Set ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to write posts.'
        }
      }
      if (err.reason === 'timeout') {
        return { success: false, error: 'Reading the post took too long. Please try again.' }
      }
    }
    console.error('A post like a shared one could not be started:', err)
    return { success: false, error: 'The post could not be started. Please try again.' }
  }
}
