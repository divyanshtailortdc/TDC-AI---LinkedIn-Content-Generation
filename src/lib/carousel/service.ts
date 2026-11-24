import 'server-only'

import { db } from '@/db'
import {
  accountsTable,
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
import type { PublishingDb } from '@/lib/publishing/connection'
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
import { forFormat } from '~/lib/ai/channel-context'
import { rewriteSlide, writeSlides } from '~/lib/ai/skills/carousel-slides'
import { collectFigureSources } from '~/lib/ai/skills/post-drafting/guard'
import { addUsage, EMPTY_USAGE, type CallUsage } from '~/lib/ai/usage'
import {
  DEFAULT_BRAND_THEME,
  LIKE_MY_POSTS,
  renderingStyleOf
} from '~/lib/brand/theme'
import type { LintFinding } from '~/lib/lint/run-linter'
import { ImageGenerationAbortedError } from '~/lib/media'
import {
  loadBrandRendering,
  type BrandRendering
} from '~/lib/media/brand-assets'
import { decodeImageDataUrl, type ImageBytes } from '~/lib/media/brand-logo'
import { buildMediaBriefContext } from '~/lib/media/brief-context'
import {
  deleteStoredImages,
  loadImageBytes,
  loadImageDataUrl,
  storeImage,
  viewableImageUrl
} from '~/lib/media/image-store'
import type { LookExample } from '~/lib/media/learned-look'
import type { PlatformId } from '~/lib/platforms'
import { loadLookExamples } from '~/lib/visual-examples/store'
import { clampWords, cleanSlideText, slideFactIssues } from './checks'
import {
  drawCarousel,
  drawSlide,
  loadSlideKit,
  makeSlidePicture,
  type SlideKit
} from './draw'
import { makeLookSlides, remakeLookSlide } from './look'
import {
  loadSlideRows,
  slideContentOf,
  slideFactIssuesOf,
  slideIssues,
  slideLookOf,
  slideRowValues,
  type SlideLook
} from './rows'
import {
  cleanDesign,
  lookDesign,
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
 *
 * In the Like my posts style, when the identity has example posts, each
 * slide is instead one image made like them (./look.ts): it carries no
 * number, so it is never redrawn, and a change to its words makes it again.
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
    const platform = FORMATS[input.formatId].platform
    // Like my posts: every slide made like the account's example posts,
    // when it has any; otherwise drawn in the brand.
    const examples =
      input.brand.theme.visualStyle === LIKE_MY_POSTS
        ? await lookExamplesFor(input.ctx.account.id, platform)
        : []
    const likeTheirPosts = examples.length > 0
    const written = await writeSlides({
      ctx: input.ctx,
      idea: input.idea,
      formatId: input.formatId,
      caption: input.caption,
      imageStyle: renderingStyleOf(input.brand.theme.visualStyle),
      instruction: input.instruction,
      likeTheirPosts
    })
    usage = written.usage
    if (input.abortSignal?.aborted) throw new ImageGenerationAbortedError()

    const notes: string[] = []
    if (likeTheirPosts) {
      const made = await makeLookSlides({
        slides: written.slides,
        examples,
        platform,
        brand: input.brand,
        caption: input.caption,
        context: buildMediaBriefContext(input.ctx, input.idea),
        accountName: input.ctx.account.name,
        direction: input.instruction,
        abortSignal: input.abortSignal
      })
      usage = addUsage(usage, made.usage)
      if (input.abortSignal?.aborted) throw new ImageGenerationAbortedError()
      if ('slides' in made && made.slides.some(m => m.image)) {
        const rows = await Promise.all(
          made.slides.map(async (m, i) =>
            slideRowValues(input.draftId, i + 1, written.slides[i]!, {
              imageUrl: m.image ? await storeImage(m.image, input.draftId) : null,
              pictureUrl: null,
              error: m.error,
              issues: m.issues,
              factIssues: written.factIssues[i] ?? [],
              picturePrompt: m.prompt,
              look: m.look
            })
          )
        )
        const slideNotes = made.slides.flatMap((m, i) =>
          [...(m.error ? [m.error] : []), ...m.issues].map(
            issue => `Slide ${i + 1}: ${issue}`
          )
        )
        return { rows, usage, issues: [...written.issues, ...slideNotes] }
      }
      // Not made like the posts: drawn in the brand, so the post keeps a carousel.
      const reason =
        'error' in made ? made.error : 'no image model drew the slides'
      notes.push(
        `The slides could not be made like your posts (${reason.replace(/\.$/, '')}), so they are drawn in your brand.`
      )
      for (const slide of written.slides) {
        slide.design = cleanDesign(slide.role, {
          layout: 'statement',
          picture: slide.role === 'cover'
        })
      }
    }

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
          factIssues: written.factIssues[i] ?? [],
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
    return {
      rows,
      usage,
      issues: [...written.issues, ...notes, ...pictureIssues]
    }
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

/**
 * A post marked posted, or out on its platform, keeps the slides that went
 * out. `database` may be a transaction holding the post's lock.
 */
async function assertEditable(draft: PostDraft, database: PublishingDb = db) {
  if (draft.postedAt) {
    throw new CarouselError(
      'This post is marked as posted, so its slides can no longer change.',
      'not_editable'
    )
  }
  if (isPublishingConfigured() && (await hasLivePublication(database, draft.id))) {
    throw new CarouselError(
      'This post is published on its platform, so its slides can no longer change.',
      'not_editable'
    )
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Runs `write` in a transaction holding the post's lock, once the locked row
 * shows its slides can still change. Every change to the slides is saved
 * this way: the check before a slide is drawn or written by AI can be
 * minutes old, and a post that went out meanwhile keeps what went out.
 */
async function whileEditable<T>(
  draftId: string,
  write: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.transaction(async tx => {
    const current = await lockPost(tx, draftId)
    if (!current) throw new CarouselError('Post not found.', 'not_found')
    await assertEditable(current, tx)
    return write(tx)
  })
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

/**
 * A link to the carousel's first drawn slide, for the post's card on the
 * Posts list; null when no slide has been drawn yet.
 */
export async function loadCarouselCover(
  accountId: string,
  draftId: string
): Promise<string | null> {
  await ownedPost(accountId, draftId)
  const rows = await loadSlideRows(db, draftId)
  const first = rows.find(row => row.imageUrl)
  return first?.imageUrl ? viewableImageUrl(first.imageUrl) : null
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
    // What its words state that no source does comes first.
    issues: [...slideFactIssuesOf(row), ...slideIssues(row)]
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

  // A post that went out while its slides were being made keeps what it went
  // out with (the stored slides are deleted below).
  const replace = async () =>
    whileEditable(draftId, async tx => {
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
  /** The identity's name: the wordmark on slides made like its posts. */
  accountName: string
  /** What the slides may state (see slideFactIssues); null without an idea. */
  figureSources: string | null
}

async function prepare(accountId: string, draftId: string): Promise<Prepared> {
  const draft = await ownedPost(accountId, draftId)
  await assertEditable(draft)
  const formatId = formatOf(draft.formatId)
  const idea = draft.ideaId ? await ideaOf(draft) : null
  const ctx = idea
    ? await loadIdeaContext(idea, {
        lintOnly: true,
        platform: draft.platform
      })
    : null
  const brand = await loadBrandRendering(
    accountId,
    ctx?.brand ?? (await loadBrandTheme(accountId))
  )
  const accountName =
    ctx?.account.name ??
    (
      await db.query.accountsTable.findFirst({
        where: eq(accountsTable.id, accountId),
        columns: { name: true }
      })
    )?.name ??
    ''
  return {
    draft,
    formatId,
    rows: await loadSlideRows(db, draftId),
    kit: await loadSlideKit(brand, ctx?.account.name ?? null),
    caption: captionOf(formatId, draft),
    accountName,
    figureSources:
      ctx && idea ? collectFigureSources(forFormat(ctx, formatId), idea) : null
  }
}

/** A slide drawn again and stored, not yet saved. */
interface DrawnSlide {
  row: PostSlide
  values: Omit<NewPostSlide, 'draftId' | 'position'>
  /** Stored for this drawing: deleted when it is not saved. */
  stored: Array<string | null>
  /** What the saved drawing replaces: deleted once it is saved. */
  replaced: Array<string | null>
}

/**
 * Draws one slide again with `content`, `picture` (stored as `pictureUrl`;
 * undefined keeps the row's), its number and the total, and stores the
 * image. Nothing is saved: see saveDrawn. `factIssues` are for new words
 * (slideFactIssues); undefined keeps the row's.
 */
async function drawRow(
  kit: SlideKit,
  row: PostSlide,
  content: SlideContent,
  total: number,
  picture?: {
    bytes: ImageBytes | null
    url: string | null
    issues?: string[]
    prompt?: string
  },
  factIssues?: string[]
): Promise<DrawnSlide> {
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
    factIssues: factIssues ?? slideFactIssuesOf(row),
    picturePrompt: picture?.prompt
  })
  const newPicture = Boolean(picture) && picture!.url !== row.pictureUrl
  return {
    row,
    values,
    stored: [imageUrl, newPicture ? picture!.url : null],
    replaced: [row.imageUrl, newPicture ? row.pictureUrl : null]
  }
}

/**
 * Saves drawn slides together, while the post can still change (see
 * whileEditable), and returns the ids saved: a slide deleted meanwhile is
 * not. What a slide replaced is deleted once it is saved; what was stored
 * for a slide that was not saved belongs to nothing and is deleted too.
 */
async function saveDrawn(
  draftId: string,
  drawn: DrawnSlide[]
): Promise<Set<string>> {
  let saved: Set<string>
  try {
    saved = await whileEditable(draftId, async tx => {
      const ids = new Set<string>()
      for (const d of drawn) {
        const [row] = await tx
          .update(postSlidesTable)
          .set({ ...d.values, updatedAt: new Date() })
          .where(eq(postSlidesTable.id, d.row.id))
          .returning({ id: postSlidesTable.id })
        if (row) ids.add(row.id)
      }
      return ids
    })
  } catch (err) {
    void deleteStoredImages(drawn.flatMap(d => d.stored))
    throw err
  }
  void deleteStoredImages(
    drawn.flatMap(d => (saved.has(d.row.id) ? d.replaced : d.stored))
  )
  return saved
}

/** Saves one slide made or drawn again. */
async function saveOne(drawn: DrawnSlide): Promise<void> {
  const saved = await saveDrawn(drawn.row.draftId, [drawn])
  if (!saved.has(drawn.row.id))
    throw new CarouselError('That slide no longer exists.', 'not_found')
}

/** Draws one slide again (as drawRow) and saves it. */
async function redrawOne(
  ...args: Parameters<typeof drawRow>
): Promise<void> {
  await saveOne(await drawRow(...args))
}

/** A slide made like the account's posts (SlideDesign.look), not drawn by code. */
const isLookRow = (row: PostSlide) => slideContentOf(row).design.look === true

/**
 * Every drawn slide drawn again, as each now stands: after a change in
 * numbering, or in the brand. Slides made like the account's posts carry
 * no number and none of the brand's drawing, so they stay as they are.
 */
async function redrawAll(
  prepared: Pick<Prepared, 'kit'>,
  draftId: string
): Promise<void> {
  const rows = await loadSlideRows(db, draftId)
  const drawn = await Promise.all(
    rows
      .filter(row => !isLookRow(row))
      .map(row => drawRow(prepared.kit, row, slideContentOf(row), rows.length))
  )
  await saveDrawn(draftId, drawn)
}

// ------------------------------------------------ slides made like the posts

/** The identity's example posts for `platform`; none when they cannot be read. */
async function lookExamplesFor(
  accountId: string,
  platform: PlatformId
): Promise<LookExample[]> {
  return loadLookExamples(accountId, platform).catch(err => {
    console.warn('Could not load the example posts:', err)
    return []
  })
}

/**
 * The design a slide is made again in: its own, else the carousel's (a
 * slide added later has none of its own), the cover's first.
 */
function lookFor(row: PostSlide, rows: PostSlide[]): SlideLook | null {
  const own = slideLookOf(row)
  if (own) return own
  const series = [...rows]
    .sort((a, b) => (a.role === 'cover' ? -1 : b.role === 'cover' ? 1 : 0))
    .map(slideLookOf)
    .find((look): look is SlideLook => look !== null)
  return series ? { ...series, scene: '', concept: '' } : null
}

/**
 * What a slide made again is made to match, attached before the examples:
 * itself as it is (only its words or scene change), else the cover, else
 * another of the carousel's slides.
 */
async function anchorFor(
  row: PostSlide,
  rows: PostSlide[],
  self: boolean
): Promise<{ image: Buffer; kind: 'cover' | 'slide' | 'self' } | null> {
  const bytesOf = async (value: string) =>
    (await loadImageBytes(value).catch(() => null))?.buffer ?? null
  if (self && row.imageUrl) {
    const image = await bytesOf(row.imageUrl)
    if (image) return { image, kind: 'self' }
  }
  const others = rows.filter(
    r => r.id !== row.id && r.imageUrl && isLookRow(r)
  )
  const cover = others.find(r => r.role === 'cover')
  const pick = cover ?? others[0]
  if (!pick?.imageUrl) return null
  const image = await bytesOf(pick.imageUrl)
  return image ? { image, kind: cover ? 'cover' : 'slide' } : null
}

/**
 * One slide made like the account's posts again, with `content` (its
 * words) and, when given, a new scene; stored, not yet saved (see
 * saveDrawn). Throws CarouselError carrying what was spent in `usage`
 * when it cannot be made, and ImageGenerationAbortedError when stopped.
 */
async function remakeLook(
  prepared: Prepared,
  row: PostSlide,
  content: SlideContent,
  options: {
    /** Only its words or scene change: made from itself as it is. */
    self: boolean
    scene?: string
    factIssues?: string[]
    abortSignal?: AbortSignal
  }
): Promise<{ drawn: DrawnSlide; usage: CallUsage }> {
  const look = lookFor(row, prepared.rows)
  if (!look) {
    throw new CarouselError(
      'This carousel has no design to follow. Write it again to make its slides.',
      'invalid'
    )
  }
  const platform = FORMATS[prepared.formatId].platform
  const [examples, anchor] = await Promise.all([
    lookExamplesFor(prepared.draft.accountId, platform),
    anchorFor(row, prepared.rows, options.self)
  ])
  if (examples.length === 0 && !anchor) {
    throw new CarouselError(
      'There are no example posts or other slides to make this slide like.',
      'invalid'
    )
  }
  const slide: SlideContent = { ...content, design: lookDesign(content.role) }
  const made = await remakeLookSlide({
    slide,
    look:
      options.scene !== undefined ? { ...look, scene: options.scene } : look,
    position: row.position,
    total: prepared.rows.length,
    anchor,
    examples,
    platform,
    brand: prepared.kit.brand,
    caption: prepared.caption,
    slides: prepared.rows.map(r => (r.id === row.id ? slide : slideContentOf(r))),
    accountName: prepared.accountName,
    abortSignal: options.abortSignal
  })
  if (!made.slide.image) {
    throw Object.assign(
      new CarouselError(
        made.slide.error ?? 'The slide could not be made.',
        'failed'
      ),
      { usage: made.usage }
    )
  }
  const imageUrl = await storeImage(made.slide.image, row.draftId)
  const {
    draftId: _draft,
    position: _position,
    ...values
  } = slideRowValues(row.draftId, row.position, slide, {
    imageUrl,
    pictureUrl: null,
    error: null,
    issues: made.slide.issues,
    factIssues: options.factIssues ?? slideFactIssuesOf(row),
    picturePrompt: made.slide.prompt,
    look: made.slide.look
  })
  return {
    drawn: {
      row,
      values,
      stored: [imageUrl],
      replaced: [row.imageUrl, row.pictureUrl]
    },
    usage: made.usage
  }
}

/** An error from making a slide again, as the caller throws it. */
function remakeError(err: unknown, stopped: string, failed: string) {
  if (err instanceof ImageGenerationAbortedError) {
    return new CarouselError(stopped, 'aborted')
  }
  return err instanceof CarouselError
    ? err
    : new CarouselError(err instanceof Error ? err.message : failed, 'failed')
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
 * design. Drawn again around the picture it has; no AI is called. A slide
 * made like the account's posts is made again with its new words instead
 * (an image-model call; see updateLookSlide).
 */
export async function updateSlide(
  accountId: string,
  draftId: string,
  slideId: string,
  patch: SlidePatch,
  options: { abortSignal?: AbortSignal } = {}
): Promise<SlideView> {
  const prepared = await prepare(accountId, draftId)
  const row = await slideOf(draftId, slideId)
  const current = slideContentOf(row)
  const headline =
    patch.headline !== undefined
      ? clampWords(cleanSlideText(patch.headline), SLIDE_TEXT.headline.hard)
      : current.headline
  if (!headline) throw new CarouselError('A slide needs a headline.', 'invalid')
  if (current.design.look) {
    return updateLookSlide(prepared, row, { ...current, headline }, patch, options)
  }
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
  // The reviewer's words are theirs to keep; what no source states is shown.
  await redrawOne(
    prepared.kit,
    row,
    next,
    prepared.rows.length,
    undefined,
    prepared.figureSources ? slideFactIssues(next, prepared.figureSources) : []
  )
  return toView(await slideOf(draftId, slideId))
}

/**
 * The reviewer's edit to a slide made like the account's posts: its words
 * and what it shows are set into the image, so the image is made again
 * from itself with the new ones. Nothing changed, nothing is made; a slide
 * that could not be made is kept as it was.
 */
async function updateLookSlide(
  prepared: Prepared,
  row: PostSlide,
  current: SlideContent,
  patch: SlidePatch,
  options: { abortSignal?: AbortSignal }
): Promise<SlideView> {
  const next: SlideContent = {
    ...current,
    body:
      patch.body !== undefined
        ? clampWords(cleanSlideText(patch.body, true), SLIDE_TEXT.body.hard)
        : row.body,
    imagePrompt:
      patch.imagePrompt !== undefined
        ? patch.imagePrompt.trim().slice(0, SLIDE_TEXT.imagePrompt.hard)
        : row.imagePrompt,
    design: lookDesign(current.role)
  }
  next.altText = [next.headline, next.body.replace(/\n/g, '. ')]
    .filter(Boolean)
    .join('. ')
  const sceneChanged = next.imagePrompt !== row.imagePrompt
  const unchanged =
    next.headline === row.headline && next.body === row.body && !sceneChanged
  if (unchanged && row.imageUrl) return toView(row)

  let usage = EMPTY_USAGE
  try {
    const made = await remakeLook(prepared, row, next, {
      self: true,
      scene: sceneChanged ? next.imagePrompt : undefined,
      // The reviewer's words are theirs to keep; what no source states is shown.
      factIssues: prepared.figureSources
        ? slideFactIssues(next, prepared.figureSources)
        : [],
      abortSignal: options.abortSignal
    })
    usage = made.usage
    await saveOne(made.drawn)
    return toView(await slideOf(row.draftId, row.id))
  } catch (err) {
    usage = addUsage(usage, spentBy(err))
    throw remakeError(
      err,
      'Making the slide again was stopped.',
      'The slide could not be made again.'
    )
  } finally {
    await recordReviewMediaSpend(row.draftId, usage, {
      summary: `Slide ${row.position} made again with new words (post review)`
    }).catch(() => {})
  }
}

/**
 * One slide written again by AI, with what the reviewer wants changed (or
 * just another take), in its place in the carousel. Keeps its picture. A
 * slide made like the account's posts is made again with the new words.
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
  const likeTheirPosts = isLookRow(row)
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
      imageStyle: prepared.kit.style,
      likeTheirPosts
    })
    usage = rewritten.usage
    if (options.abortSignal?.aborted) {
      throw new CarouselError('Rewriting the slide was stopped.', 'aborted')
    }
    if (likeTheirPosts) {
      // New words, so a new scene too: made to match the cover, not itself.
      const made = await remakeLook(prepared, row, rewritten.slide, {
        self: false,
        scene: rewritten.slide.imagePrompt,
        factIssues: rewritten.factIssues,
        abortSignal: options.abortSignal
      })
      usage = addUsage(usage, made.usage)
      await saveOne(made.drawn)
      return toView(await slideOf(draftId, slideId))
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
      keepsPicture ? undefined : { bytes: null, url: null },
      rewritten.factIssues
    )
    return toView(await slideOf(draftId, slideId))
  } catch (err) {
    // A failed call's spend rides on its error (SkillError, or a slide not made).
    usage = addUsage(usage, spentBy(err))
    throw remakeError(
      err,
      'Rewriting the slide was stopped.',
      'The slide could not be rewritten.'
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

  if (current.design.look) {
    return remakeLookSlideForPost(prepared, row, current, options)
  }

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

/**
 * Another take of a slide made like the account's posts ("Make again"),
 * with `prompt` as what it shows when given (saved as its prompt), made to
 * match the cover. It has no separate picture to remove.
 */
async function remakeLookSlideForPost(
  prepared: Prepared,
  row: PostSlide,
  current: SlideContent,
  options: { remove?: boolean; prompt?: string | null; abortSignal?: AbortSignal }
): Promise<SlideView> {
  if (options.remove) {
    throw new CarouselError(
      'This slide is one image made like your posts, so it has no separate picture to remove.',
      'invalid'
    )
  }
  const scene = options.prompt?.trim().slice(0, SLIDE_TEXT.imagePrompt.hard)
  const next: SlideContent = {
    ...current,
    imagePrompt: scene || current.imagePrompt
  }
  let usage = EMPTY_USAGE
  try {
    const made = await remakeLook(prepared, row, next, {
      self: false,
      scene: scene || undefined,
      abortSignal: options.abortSignal
    })
    usage = made.usage
    await saveOne(made.drawn)
    return toView(await slideOf(row.draftId, row.id))
  } catch (err) {
    usage = addUsage(usage, spentBy(err))
    throw remakeError(
      err,
      'Making the slide again was stopped.',
      'The slide could not be made again.'
    )
  } finally {
    await recordReviewMediaSpend(row.draftId, usage, {
      summary: `Slide ${row.position} made again (post review)`
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
  await whileEditable(draftId, async tx => {
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
  await whileEditable(draftId, async tx => {
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
  // Each drawn slide shows its number; one made like the posts does not.
  const drawn = await Promise.all(
    [
      { ...row, position: other.position },
      { ...other, position: row.position }
    ]
      .filter(moved => !isLookRow(moved))
      .map(moved => drawRow(prepared.kit, moved, slideContentOf(moved), total))
  )
  await saveDrawn(draftId, drawn)
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
  // In a carousel made like the posts, the new slide is made once it has
  // words: making "New slide" would be paid for and thrown away.
  const likeTheirPosts = prepared.rows.some(isLookRow)
  const slide: SlideContent = {
    role: 'content',
    headline: 'New slide',
    body: '',
    imagePrompt: '',
    design: likeTheirPosts
      ? lookDesign('content')
      : { layout: 'statement', picture: false, emphasis: [] },
    altText: 'New slide'
  }
  await whileEditable(draftId, async tx => {
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
        error: likeTheirPosts
          ? 'Not made yet: edit its words or write it with AI, and it is made like the other slides.'
          : null,
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
