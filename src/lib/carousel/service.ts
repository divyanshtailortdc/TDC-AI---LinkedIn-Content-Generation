import 'server-only'

import { db } from '@/db'
import {
  ideasTable,
  postDraftsTable,
  postSlidesTable,
  type Idea,
  type NewPostSlide,
  type PostDraft,
  type PostSlide
} from '@/db/schema'
import {
  carouselSpecOf,
  formatOf,
  FORMATS,
  postTexts,
  type FormatId
} from '@/lib/formats'
import { lockPost } from '@/lib/post-revisions'
import { isPublishingConfigured } from '@/lib/publishing/config'
import { hasLivePublication } from '@/lib/publishing/publication-queries'
import { and, eq, gt, sql } from 'drizzle-orm'
import {
  loadBrandTheme,
  loadIdeaContext,
  type GenerationContext
} from '~/lib/ai/context'
import { recheckPostText } from '~/lib/ai/pipeline/post-recheck'
import { recordReviewMediaSpend } from '~/lib/ai/run-accounting'
import { SkillError } from '~/lib/ai/run-skill'
import { rewriteSlide, writeSlides } from '~/lib/ai/skills/carousel-slides'
import { addUsage, EMPTY_USAGE, type CallUsage } from '~/lib/ai/usage'
import { DEFAULT_BRAND_THEME } from '~/lib/brand/theme'
import type { LintFinding } from '~/lib/lint/run-linter'
import { ImageGenerationAbortedError } from '~/lib/media'
import {
  loadBrandRendering,
  type BrandRendering
} from '~/lib/media/brand-assets'
import { decodeImageDataUrl, type ImageBytes } from '~/lib/media/brand-logo'
import {
  deleteStoredImages,
  loadImageDataUrl,
  storeImage,
  viewableImageUrl
} from '~/lib/media/image-store'
import { clampWords, cleanSlideText } from './checks'
import {
  drawCarousel,
  drawSlide,
  loadSlideKit,
  makeSlidePicture,
  type SlideKit
} from './draw'
import {
  loadSlideRows,
  slideContentOf,
  slideIssues,
  slideRowValues
} from './rows'
import {
  cleanDesign,
  PICTURE_LAYOUTS,
  SLIDE_TEXT,
  type SlideContent,
  type SlideDesign,
  type SlideView
} from './types'

/**
 * Everything done to a carousel post's slides: making them (while drafting,
 * or when the reviewer turns a post into a carousel), editing one, writing
 * one again with AI, adding or removing a slide's picture, and adding,
 * removing or moving slides. Every change redraws what it touched; a
 * change in numbering redraws every slide, since each shows "n / total".
 * A post that is out on its platform keeps its slides.
 */

export type CarouselErrorCode =
  'not_found' | 'not_editable' | 'invalid' | 'failed' | 'aborted'

export class CarouselError extends Error {
  constructor(
    message: string,
    readonly code: CarouselErrorCode
  ) {
    super(message)
    this.name = 'CarouselError'
  }
}

/** The caption as it is posted beside the slides. */
export const captionOf = (
  formatId: FormatId,
  post: Parameters<typeof postTexts>[1]
) => postTexts(formatId, post).join('\n\n')

// --------------------------------------------------------------- creating

export interface BuiltCarousel {
  rows: NewPostSlide[]
  usage: CallUsage
  /** What the reviewer should know: slides that repeat the caption, pictures with problems. */
  issues: string[]
}

/**
 * A carousel's slides for a post, written, drawn and stored under its id,
 * ready to insert. Throws CarouselError ('aborted' when stopped, 'failed'
 * otherwise) carrying what was spent in `usage` on the error.
 */
export async function buildCarouselRows(input: {
  ctx: GenerationContext
  idea: Idea
  formatId: FormatId
  caption: string
  brand: BrandRendering
  draftId: string
  instruction?: string | null
  abortSignal?: AbortSignal
}): Promise<BuiltCarousel> {
  let usage = EMPTY_USAGE
  try {
    const written = await writeSlides({
      ctx: input.ctx,
      idea: input.idea,
      formatId: input.formatId,
      caption: input.caption,
      imageStyle: input.brand.theme.visualStyle,
      instruction: input.instruction
    })
    usage = written.usage
    if (input.abortSignal?.aborted) throw new ImageGenerationAbortedError()

    const kit = await loadSlideKit(input.brand, input.ctx.account.name)
    const drawn = await drawCarousel(kit, written.slides, {
      caption: input.caption,
      abortSignal: input.abortSignal
    })
    usage = addUsage(usage, drawn.usage)
    if (input.abortSignal?.aborted) throw new ImageGenerationAbortedError()

    const rows = await Promise.all(
      drawn.slides.map(async (d, i) =>
        slideRowValues(input.draftId, i + 1, d.slide, {
          imageUrl: d.image ? await storeImage(d.image, input.draftId) : null,
          pictureUrl: d.picture
            ? await storeImage(d.picture, input.draftId)
            : null,
          error: d.error,
          issues: d.issues,
          picturePrompt: d.picturePrompt
        })
      )
    )
    if (rows.every(r => !r.imageUrl)) {
      throw new CarouselError('None of the slides could be drawn.', 'failed')
    }
    const pictureIssues = drawn.slides.flatMap((d, i) =>
      d.issues.map(issue => `Slide ${i + 1}: ${issue}`)
    )
    return { rows, usage, issues: [...written.issues, ...pictureIssues] }
  } catch (err) {
    const spent = err instanceof SkillError ? addUsage(usage, err.usage) : usage
    const wrapped =
      err instanceof ImageGenerationAbortedError || input.abortSignal?.aborted
        ? new CarouselError('Making the slides was stopped.', 'aborted')
        : err instanceof CarouselError
          ? err
          : new CarouselError(
              err instanceof Error
                ? err.message
                : 'The slides could not be made.',
              'failed'
            )
    throw Object.assign(wrapped, { usage: spent })
  }
}

/** What an error from buildCarouselRows spent before it failed. */
export const spentBy = (err: unknown): CallUsage =>
  ((err as { usage?: CallUsage } | null)?.usage as CallUsage | undefined) ??
  EMPTY_USAGE

// ----------------------------------------------------------------- access

async function ownedPost(
  accountId: string,
  draftId: string
): Promise<PostDraft> {
  const draft = await db.query.postDraftsTable.findFirst({
    where: and(
      eq(postDraftsTable.id, draftId),
      eq(postDraftsTable.accountId, accountId)
    )
  })
  if (!draft) throw new CarouselError('Post not found.', 'not_found')
  return draft
}

/** A post marked posted, or out on its platform, keeps the slides that went out. */
async function assertEditable(draft: PostDraft) {
  if (draft.postedAt) {
    throw new CarouselError(
      'This post is marked as posted, so its slides can no longer change.',
      'not_editable'
    )
  }
  if (isPublishingConfigured() && (await hasLivePublication(db, draft.id))) {
    throw new CarouselError(
      'This post is published on its platform, so its slides can no longer change.',
      'not_editable'
    )
  }
}

async function ideaOf(draft: PostDraft): Promise<Idea> {
  const idea = draft.ideaId
    ? await db.query.ideasTable.findFirst({
        where: eq(ideasTable.id, draft.ideaId)
      })
    : null
  if (!idea) {
    throw new CarouselError(
      'This post has no idea behind it to write slides from.',
      'invalid'
    )
  }
  return idea
}

async function brandFor(ctx: GenerationContext): Promise<BrandRendering> {
  return loadBrandRendering(ctx.account.id, ctx.brand ?? DEFAULT_BRAND_THEME)
}

async function slideOf(draftId: string, slideId: string): Promise<PostSlide> {
  const [row] = await db
    .select()
    .from(postSlidesTable)
    .where(
      and(eq(postSlidesTable.id, slideId), eq(postSlidesTable.draftId, draftId))
    )
    .limit(1)
  if (!row) throw new CarouselError('That slide no longer exists.', 'not_found')
  return row
}

async function pictureOf(
  row: Pick<PostSlide, 'pictureUrl'>
): Promise<ImageBytes | null> {
  if (!row.pictureUrl) return null
  try {
    return decodeImageDataUrl(await loadImageDataUrl(row.pictureUrl))
  } catch (err) {
    console.error('Could not load a slide picture:', err)
    return null
  }
}

// ------------------------------------------------------------------ reading

/** A post's slides as the review screen shows them, with links to each image. */
export async function loadCarousel(
  accountId: string,
  draftId: string
): Promise<SlideView[]> {
  await ownedPost(accountId, draftId)
  const rows = await loadSlideRows(db, draftId)
  return Promise.all(rows.map(toView))
}

async function toView(row: PostSlide): Promise<SlideView> {
  let imageUrl: string | null = null
  if (row.imageUrl) {
    try {
      imageUrl = await viewableImageUrl(row.imageUrl)
    } catch (err) {
      console.error(`Could not link slide ${row.id}:`, err)
    }
  }
  return {
    id: row.id,
    position: row.position,
    ...slideContentOf(row),
    imageUrl,
    hasPicture: Boolean(row.pictureUrl),
    status: row.renderStatus === 'failed' ? 'failed' : 'ready',
    error: row.renderError,
    issues: slideIssues(row)
  }
}

/** The drawn slides' bytes, in order, for a download or for publishing. */
export async function loadSlideImages(
  accountId: string,
  draftId: string
): Promise<Array<ImageBytes & { altText: string | null }>> {
  await ownedPost(accountId, draftId)
  const rows = await loadSlideRows(db, draftId)
  const images = await Promise.all(
    rows.map(async row => {
      if (!row.imageUrl) return null
      const image = decodeImageDataUrl(await loadImageDataUrl(row.imageUrl))
      return image ? { ...image, altText: row.altText } : null
    })
  )
  return images.filter((i): i is NonNullable<typeof i> => i !== null)
}

/**
 * Runs the post's checks again after what goes out with it changed (a
 * caption that says "swipe" is fine on a carousel and wrong without one),
 * and saves them.
 */
export async function refreshPostChecks(
  draftId: string
): Promise<LintFinding[]> {
  const draft = await db.query.postDraftsTable.findFirst({
    where: eq(postDraftsTable.id, draftId)
  })
  if (!draft) return []
  const { lintFindings } = await recheckPostText(draft, {
    hook: draft.hook,
    body: draft.body,
    cta: draft.cta,
    firstComment: draft.firstComment,
    hashtags: draft.hashtags ?? [],
    payload: draft.payload ?? null
  })
  await db
    .update(postDraftsTable)
    .set({ lintFindings })
    .where(eq(postDraftsTable.id, draftId))
  return lintFindings
}

// ----------------------------------------------------------------- creating

/**
 * Turns a post into a carousel, or writes its carousel again: the slides
 * are written from its idea and caption, drawn and saved, replacing any it
 * had, and the post goes out as a carousel. The spend is charged to the
 * post's run.
 */
export async function createCarouselForPost(
  accountId: string,
  draftId: string,
  options: {
    instruction?: string | null
    abortSignal?: AbortSignal
    /**
     * Write a carousel the post already has again ("Write again"). Without
     * it, a post that has slides keeps them: a screen that failed to show
     * them must not have them paid for and written over.
     */
    replace?: boolean
  } = {}
): Promise<{
  slides: SlideView[]
  issues: string[]
  lintFindings: LintFinding[]
  /** The post already had these slides; nothing was written. */
  existing: boolean
}> {
  const draft = await ownedPost(accountId, draftId)
  const formatId = formatOf(draft.formatId)
  if (!carouselSpecOf(formatId)) {
    throw new CarouselError(
      `A ${FORMATS[formatId].label} cannot be a carousel.`,
      'invalid'
    )
  }
  await assertEditable(draft)

  // Checked before any model is called, so it costs nothing.
  if (!options.replace) {
    const [had] = await db
      .select({ id: postSlidesTable.id })
      .from(postSlidesTable)
      .where(eq(postSlidesTable.draftId, draftId))
      .limit(1)
    if (had) {
      if (draft.mediaFormat !== 'carousel') {
        await db
          .update(postDraftsTable)
          .set({ mediaFormat: 'carousel', updatedAt: new Date() })
          .where(eq(postDraftsTable.id, draftId))
      }
      return {
        slides: await loadCarousel(accountId, draftId),
        issues: [],
        lintFindings: await refreshPostChecks(draftId),
        existing: true
      }
    }
  }

  const idea = await ideaOf(draft)
  const ctx = await loadIdeaContext(idea, { platform: draft.platform })

  let built: BuiltCarousel
  try {
    built = await buildCarouselRows({
      ctx,
      idea,
      formatId,
      caption: captionOf(formatId, draft),
      brand: await brandFor(ctx),
      draftId,
      instruction: options.instruction,
      abortSignal: options.abortSignal
    })
  } catch (err) {
    await recordReviewMediaSpend(draftId, spentBy(err), {
      summary: 'Carousel slides (post review)',
      error:
        err instanceof Error ? err.message : 'The slides could not be made.'
    }).catch(() => {})
    throw err
  }
  await recordReviewMediaSpend(draftId, built.usage, {
    summary: `Carousel of ${built.rows.length} slides (post review)`
  }).catch(() => {})
  if (options.abortSignal?.aborted) {
    void deleteStoredImages(built.rows.flatMap(r => [r.imageUrl, r.pictureUrl]))
    throw new CarouselError('Making the slides was stopped.', 'aborted')
  }

  const replace = async () =>
    db.transaction(async tx => {
      const current = await lockPost(tx, draftId)
      if (!current) throw new CarouselError('Post not found.', 'not_found')
      // Again on the locked row: a post that went out while its slides were
      // being made keeps what it went out with (the stored slides are
      // deleted below).
      await assertEditable(current)
      const old = await tx
        .select({
          imageUrl: postSlidesTable.imageUrl,
          pictureUrl: postSlidesTable.pictureUrl
        })
        .from(postSlidesTable)
        .where(eq(postSlidesTable.draftId, draftId))
      await tx
        .delete(postSlidesTable)
        .where(eq(postSlidesTable.draftId, draftId))
      await tx.insert(postSlidesTable).values(built.rows)
      await tx
        .update(postDraftsTable)
        .set({ mediaFormat: 'carousel', updatedAt: new Date() })
        .where(eq(postDraftsTable.id, draftId))
      return old
    })
  let previous: Awaited<ReturnType<typeof replace>>
  try {
    previous = await replace()
  } catch (err) {
    // Not saved: nothing points at the images just stored for it.
    void deleteStoredImages(built.rows.flatMap(r => [r.imageUrl, r.pictureUrl]))
    throw err
  }
  void deleteStoredImages(previous.flatMap(r => [r.imageUrl, r.pictureUrl]))
  return {
    slides: await loadCarousel(accountId, draftId),
    issues: built.issues,
    lintFindings: await refreshPostChecks(draftId),
    existing: false
  }
}

// ----------------------------------------------------------------- drawing

interface Prepared {
  draft: PostDraft
  formatId: FormatId
  rows: PostSlide[]
  kit: SlideKit
  caption: string
}

async function prepare(accountId: string, draftId: string): Promise<Prepared> {
  const draft = await ownedPost(accountId, draftId)
  await assertEditable(draft)
  const formatId = formatOf(draft.formatId)
  const ctx = draft.ideaId
    ? await loadIdeaContext(await ideaOf(draft), {
        lintOnly: true,
        platform: draft.platform
      })
    : null
  const brand = await loadBrandRendering(
    accountId,
    ctx?.brand ?? (await loadBrandTheme(accountId))
  )
  return {
    draft,
    formatId,
    rows: await loadSlideRows(db, draftId),
    kit: await loadSlideKit(brand, ctx?.account.name ?? null),
    caption: captionOf(formatId, draft)
  }
}

/**
 * Draws one slide again and saves it with `content`, `picture` (stored as
 * `pictureUrl`; undefined keeps the row's), its number and the total.
 */
async function redrawOne(
  kit: SlideKit,
  row: PostSlide,
  content: SlideContent,
  total: number,
  picture?: {
    bytes: ImageBytes | null
    url: string | null
    issues?: string[]
    prompt?: string
  }
): Promise<void> {
  const bytes = picture ? picture.bytes : await pictureOf(row)
  let imageUrl: string | null = null
  let error: string | null = null
  try {
    const image = await drawSlide(
      kit,
      content,
      { number: row.position, total },
      bytes
    )
    imageUrl = await storeImage(image, row.draftId)
  } catch (err) {
    console.error(`Could not draw slide ${row.id}:`, err)
    error = err instanceof Error ? err.message : 'The slide could not be drawn.'
  }
  // Where it sits is the row's own; only what it shows changes here.
  const {
    draftId: _draft,
    position: _position,
    ...values
  } = slideRowValues(row.draftId, row.position, content, {
    imageUrl,
    pictureUrl: picture ? picture.url : row.pictureUrl,
    error,
    issues: picture?.issues ?? (picture ? [] : slideIssues(row)),
    picturePrompt: picture?.prompt
  })
  const [saved] = await db
    .update(postSlidesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(postSlidesTable.id, row.id))
    .returning({ id: postSlidesTable.id })
  // Deleted meanwhile: what was just stored belongs to nothing.
  const replaced = saved ? [row.imageUrl] : [imageUrl]
  if (picture && saved && row.pictureUrl !== picture.url)
    replaced.push(row.pictureUrl)
  void deleteStoredImages(replaced)
  if (!saved)
    throw new CarouselError('That slide no longer exists.', 'not_found')
}

/** Every slide drawn again, as each now stands: after a change in numbering, or in the brand. */
async function redrawAll(
  prepared: Pick<Prepared, 'kit'>,
  draftId: string
): Promise<void> {
  const rows = await loadSlideRows(db, draftId)
  await Promise.all(
    rows.map(row =>
      redrawOne(prepared.kit, row, slideContentOf(row), rows.length)
    )
  )
}

// ------------------------------------------------------------------ editing

export interface SlidePatch {
  headline?: string
  body?: string
  imagePrompt?: string
  design?: Partial<Pick<SlideDesign, 'layout' | 'icon' | 'stat' | 'emphasis'>>
}

/**
 * The reviewer's own edit to one slide: its words, picture prompt or
 * design. Drawn again around the picture it has; no AI is called.
 */
export async function updateSlide(
  accountId: string,
  draftId: string,
  slideId: string,
  patch: SlidePatch
): Promise<SlideView> {
  const prepared = await prepare(accountId, draftId)
  const row = await slideOf(draftId, slideId)
  const current = slideContentOf(row)
  const headline =
    patch.headline !== undefined
      ? clampWords(cleanSlideText(patch.headline), SLIDE_TEXT.headline.hard)
      : current.headline
  if (!headline) throw new CarouselError('A slide needs a headline.', 'invalid')
  const merged = { ...current.design, ...patch.design }
  const design = cleanDesign(current.role, {
    ...merged,
    // Edits never generate a picture: the slide keeps the one it has where
    // its layout still shows one.
    picture: Boolean(row.pictureUrl)
  })
  const next: SlideContent = {
    ...current,
    headline,
    body:
      patch.body !== undefined
        ? clampWords(
            cleanSlideText(patch.body, design.layout === 'list'),
            SLIDE_TEXT.body.hard
          )
        : current.body,
    imagePrompt:
      patch.imagePrompt !== undefined
        ? patch.imagePrompt.trim().slice(0, SLIDE_TEXT.imagePrompt.hard)
        : current.imagePrompt,
    design
  }
  next.altText = [next.headline, next.body.replace(/\n/g, '. ')]
    .filter(Boolean)
    .join('. ')
  await redrawOne(prepared.kit, row, next, prepared.rows.length)
  return toView(await slideOf(draftId, slideId))
}

/**
 * One slide written again by AI, with what the reviewer wants changed (or
 * just another take), in its place in the carousel. Keeps its picture.
 */
export async function rewriteSlideForPost(
  accountId: string,
  draftId: string,
  slideId: string,
  options: { instruction: string | null; abortSignal?: AbortSignal }
): Promise<SlideView> {
  const prepared = await prepare(accountId, draftId)
  const row = await slideOf(draftId, slideId)
  const idea = await ideaOf(prepared.draft)
  const ctx = await loadIdeaContext(idea, { platform: prepared.draft.platform })
  const index = prepared.rows.findIndex(r => r.id === slideId)
  let usage = EMPTY_USAGE
  try {
    const rewritten = await rewriteSlide({
      ctx,
      idea,
      formatId: prepared.formatId,
      caption: prepared.caption,
      slides: prepared.rows.map(slideContentOf),
      index,
      instruction: options.instruction,
      imageStyle: prepared.kit.style
    })
    usage = rewritten.usage
    if (options.abortSignal?.aborted) {
      throw new CarouselError('Rewriting the slide was stopped.', 'aborted')
    }
    // A picture is kept only where the new layout still shows one.
    const keepsPicture =
      Boolean(row.pictureUrl) &&
      PICTURE_LAYOUTS.includes(rewritten.slide.design.layout)
    rewritten.slide.design.picture = keepsPicture
    await redrawOne(
      prepared.kit,
      row,
      rewritten.slide,
      prepared.rows.length,
      keepsPicture ? undefined : { bytes: null, url: null }
    )
    return toView(await slideOf(draftId, slideId))
  } catch (err) {
    if (err instanceof SkillError) usage = addUsage(usage, err.usage)
    throw err instanceof CarouselError
      ? err
      : new CarouselError(
          err instanceof Error
            ? err.message
            : 'The slide could not be rewritten.',
          'failed'
        )
  } finally {
    await recordReviewMediaSpend(draftId, usage, {
      summary: `Slide ${row.position} written again (post review)`
    }).catch(() => {})
  }
}

/**
 * Gives one slide a new picture from its picture prompt (or `prompt`, which
 * is saved as its prompt), or takes its picture away. A content slide
 * without a picture layout becomes a photo slide to show it.
 */
export async function setSlidePicture(
  accountId: string,
  draftId: string,
  slideId: string,
  options: {
    remove?: boolean
    prompt?: string | null
    abortSignal?: AbortSignal
  }
): Promise<SlideView> {
  const prepared = await prepare(accountId, draftId)
  const row = await slideOf(draftId, slideId)
  const current = slideContentOf(row)

  if (options.remove) {
    const next: SlideContent = {
      ...current,
      design: cleanDesign(current.role, {
        ...current.design,
        layout:
          current.design.layout === 'photo'
            ? 'statement'
            : current.design.layout,
        picture: false
      })
    }
    await redrawOne(prepared.kit, row, next, prepared.rows.length, {
      bytes: null,
      url: null
    })
    return toView(await slideOf(draftId, slideId))
  }

  const imagePrompt = (
    options.prompt?.trim() ||
    current.imagePrompt ||
    current.headline
  ).slice(0, SLIDE_TEXT.imagePrompt.hard)
  const layout = PICTURE_LAYOUTS.includes(current.design.layout)
    ? current.design.layout
    : 'photo'
  const next: SlideContent = {
    ...current,
    imagePrompt,
    design: cleanDesign(current.role, {
      ...current.design,
      layout,
      picture: true
    })
  }
  let usage = EMPTY_USAGE
  try {
    const made = await makeSlidePicture(prepared.kit, next, {
      caption: prepared.caption,
      abortSignal: options.abortSignal
    })
    usage = made.usage
    if (options.abortSignal?.aborted) throw new ImageGenerationAbortedError()
    const url = await storeImage(made.picture, draftId)
    await redrawOne(prepared.kit, row, next, prepared.rows.length, {
      bytes: made.picture,
      url,
      issues: made.issues,
      prompt: made.prompt
    })
    return toView(await slideOf(draftId, slideId))
  } catch (err) {
    if (
      err instanceof ImageGenerationAbortedError ||
      options.abortSignal?.aborted
    ) {
      throw new CarouselError('Making the picture was stopped.', 'aborted')
    }
    throw err instanceof CarouselError
      ? err
      : new CarouselError(
          err instanceof Error ? err.message : 'The picture could not be made.',
          'failed'
        )
  } finally {
    await recordReviewMediaSpend(draftId, usage, {
      summary: `Picture for slide ${row.position} (post review)`
    }).catch(() => {})
  }
}

// ---------------------------------------------------------------- structure

/** Removes a content slide; the cover and the call to action stay. */
export async function deleteSlide(
  accountId: string,
  draftId: string,
  slideId: string
) {
  const prepared = await prepare(accountId, draftId)
  const row = await slideOf(draftId, slideId)
  if (row.role !== 'content') {
    throw new CarouselError(
      'The cover and the last slide stay; edit them instead.',
      'invalid'
    )
  }
  const min = carouselSpecOf(prepared.formatId)?.minSlides ?? 2
  if (prepared.rows.length - 1 < Math.max(min, 2)) {
    throw new CarouselError(
      `A carousel needs at least ${Math.max(min, 2)} slides.`,
      'invalid'
    )
  }
  await db.transaction(async tx => {
    await lockPost(tx, draftId)
    await tx.delete(postSlidesTable).where(eq(postSlidesTable.id, slideId))
    await tx
      .update(postSlidesTable)
      .set({ position: sql`${postSlidesTable.position} - 1` })
      .where(
        and(
          eq(postSlidesTable.draftId, draftId),
          gt(postSlidesTable.position, row.position)
        )
      )
  })
  void deleteStoredImages([row.imageUrl, row.pictureUrl])
  await redrawAll(prepared, draftId)
  return loadCarousel(accountId, draftId)
}

/** Moves a content slide one place; it cannot pass the cover or the call to action. */
export async function moveSlide(
  accountId: string,
  draftId: string,
  slideId: string,
  direction: 'up' | 'down'
) {
  const prepared = await prepare(accountId, draftId)
  const index = prepared.rows.findIndex(r => r.id === slideId)
  const row = prepared.rows[index]
  const other = prepared.rows[direction === 'up' ? index - 1 : index + 1]
  if (!row) throw new CarouselError('That slide no longer exists.', 'not_found')
  if (row.role !== 'content' || !other || other.role !== 'content') {
    throw new CarouselError(
      'The cover stays first and the call to action last.',
      'invalid'
    )
  }
  await db.transaction(async tx => {
    await lockPost(tx, draftId)
    await tx
      .update(postSlidesTable)
      .set({ position: other.position })
      .where(eq(postSlidesTable.id, row.id))
    await tx
      .update(postSlidesTable)
      .set({ position: row.position })
      .where(eq(postSlidesTable.id, other.id))
  })
  const total = prepared.rows.length
  await Promise.all([
    redrawOne(
      prepared.kit,
      { ...row, position: other.position },
      slideContentOf(row),
      total
    ),
    redrawOne(
      prepared.kit,
      { ...other, position: row.position },
      slideContentOf(other),
      total
    )
  ])
  return loadCarousel(accountId, draftId)
}

/**
 * Adds a content slide after `afterPosition` (before the call to action at
 * the latest), for the reviewer to fill in or have written.
 */
export async function addSlide(
  accountId: string,
  draftId: string,
  afterPosition: number
) {
  const prepared = await prepare(accountId, draftId)
  const max = carouselSpecOf(prepared.formatId)?.maxSlides ?? 10
  if (prepared.rows.length >= max) {
    throw new CarouselError(
      `${FORMATS[prepared.formatId].label} carousels take at most ${max} slides.`,
      'invalid'
    )
  }
  if (prepared.rows.length === 0) {
    throw new CarouselError('Make the carousel first.', 'invalid')
  }
  // After the cover at the earliest, before the call to action at the latest.
  const position =
    Math.min(Math.max(afterPosition, 1), prepared.rows.length - 1) + 1
  const slide: SlideContent = {
    role: 'content',
    headline: 'New slide',
    body: '',
    imagePrompt: '',
    design: { layout: 'statement', picture: false, emphasis: [] },
    altText: 'New slide'
  }
  await db.transaction(async tx => {
    await lockPost(tx, draftId)
    await tx
      .update(postSlidesTable)
      .set({ position: sql`${postSlidesTable.position} + 1` })
      .where(
        and(
          eq(postSlidesTable.draftId, draftId),
          gt(postSlidesTable.position, position - 1)
        )
      )
    await tx.insert(postSlidesTable).values(
      slideRowValues(draftId, position, slide, {
        imageUrl: null,
        pictureUrl: null,
        error: null,
        issues: []
      })
    )
  })
  await redrawAll(prepared, draftId)
  return loadCarousel(accountId, draftId)
}

/** Every slide drawn again in the brand as it now is (colours, fonts, logo); no AI. */
export async function redrawCarousel(accountId: string, draftId: string) {
  const prepared = await prepare(accountId, draftId)
  if (prepared.rows.length === 0)
    throw new CarouselError('This post has no slides yet.', 'invalid')
  await redrawAll(prepared, draftId)
  return loadCarousel(accountId, draftId)
}
