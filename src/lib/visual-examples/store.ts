import 'server-only'

import { db } from '@/db'
import {
  postDraftsTable,
  postMediaTable,
  postSlidesTable,
  visualExamplesTable
} from '@/db/schema'
import { imageSize } from '@/lib/media/brand-logo'
import {
  deleteStoredImages,
  loadImageBytes,
  storeExampleImage,
  viewableImageUrl
} from '@/lib/media/image-store'
import type { LookExample } from '@/lib/media/learned-look'
import type { PlatformId } from '@/lib/platforms'
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { pickLookExamples, type StoredExample } from './pick'
import { RECENT_LOOKS_SHOWN, recentLookOf, type RecentLook } from './recent'
import {
  LEARNED_SOURCES,
  UPLOAD_TYPES,
  VISUAL_EXAMPLE_LIMITS,
  type VisualExampleSource,
  type VisualExampleView
} from './types'

/**
 * An identity's example posts: saved by the profile analysis and by the
 * user's uploads, shown on the Profile page, and handed to image generation
 * (with their bytes) so new images follow them.
 */

type Executor = Pick<typeof db, 'select' | 'insert' | 'delete'>

/** An image as stored: JPEG, no larger than the stored side, so references stay small. */
async function normalized(
  data: Uint8Array
): Promise<{
  buffer: Buffer
  mediaType: string
  width: number
  height: number
}> {
  const side = VISUAL_EXAMPLE_LIMITS.storedSide
  const { data: buffer, info } = await sharp(data)
    .rotate()
    .resize(side, side, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  return {
    buffer,
    mediaType: 'image/jpeg',
    width: info.width,
    height: info.height
  }
}

/**
 * Replaces the examples a profile analysis saved for a platform with the
 * images it found this time. A run that found none keeps the earlier ones,
 * as a failed refresh keeps the earlier insights.
 */
export async function replaceLearnedExamples(
  accountId: string,
  platform: PlatformId,
  images: Array<{
    data: Uint8Array
    postUrl: string
    source: 'search' | 'buffer'
  }>
): Promise<number> {
  const kept = images.slice(0, VISUAL_EXAMPLE_LIMITS.learned)
  if (kept.length === 0) return 0
  const stored = (
    await Promise.all(
      kept.map(async image => {
        try {
          const n = await normalized(image.data)
          return {
            imageUrl: await storeExampleImage(n, accountId),
            postUrl: image.postUrl,
            source: image.source,
            width: n.width,
            height: n.height
          }
        } catch (err) {
          console.warn('An example image could not be read:', err)
          return null
        }
      })
    )
  ).filter((s): s is NonNullable<typeof s> => s !== null)
  if (stored.length === 0) return 0

  const t = visualExamplesTable
  const old = await db.transaction(async tx => {
    const previous = await tx
      .delete(t)
      .where(
        and(
          eq(t.accountId, accountId),
          eq(t.platform, platform),
          inArray(t.source, [...LEARNED_SOURCES])
        )
      )
      .returning({ imageUrl: t.imageUrl })
    await tx.insert(t).values(stored.map(s => ({ ...s, accountId, platform })))
    return previous
  })
  await deleteStoredImages(old.map(r => r.imageUrl))
  return stored.length
}

/**
 * Drops the examples analyses saved for these platforms: their link was
 * removed or now names another account. Uploads stay.
 */
export async function dropLearnedExamples(
  accountId: string,
  platforms: PlatformId[],
  executor: Executor = db
): Promise<void> {
  if (platforms.length === 0) return
  const t = visualExamplesTable
  const gone = await executor
    .delete(t)
    .where(
      and(
        eq(t.accountId, accountId),
        inArray(t.platform, platforms),
        inArray(t.source, [...LEARNED_SOURCES])
      )
    )
    .returning({ imageUrl: t.imageUrl })
  await deleteStoredImages(gone.map(r => r.imageUrl))
}

/** Why an upload was refused, in words for the user. */
export class ExampleUploadError extends Error {}

/** Saves images the user uploaded as examples for a platform. */
export async function addUploadedExamples(
  accountId: string,
  platform: PlatformId,
  files: Array<{ data: Uint8Array; mediaType: string; name?: string }>
): Promise<number> {
  const t = visualExamplesTable
  const existing = await db
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.accountId, accountId),
        eq(t.platform, platform),
        eq(t.source, 'upload')
      )
    )
  const room = VISUAL_EXAMPLE_LIMITS.uploads - existing.length
  if (room <= 0) {
    throw new ExampleUploadError(
      `You already have ${VISUAL_EXAMPLE_LIMITS.uploads} example images here. Remove one to add another.`
    )
  }
  for (const file of files) {
    if (!(UPLOAD_TYPES as readonly string[]).includes(file.mediaType)) {
      throw new ExampleUploadError(
        `${file.name ?? 'A file'} is not a JPEG, PNG or WebP image.`
      )
    }
    if (file.data.byteLength > VISUAL_EXAMPLE_LIMITS.uploadBytes) {
      throw new ExampleUploadError(
        `${file.name ?? 'An image'} is larger than ${VISUAL_EXAMPLE_LIMITS.uploadBytes / 1024 / 1024} MB.`
      )
    }
  }
  const taken = files.slice(0, room)
  const rows = await Promise.all(
    taken.map(async file => {
      let n: Awaited<ReturnType<typeof normalized>>
      try {
        n = await normalized(file.data)
      } catch {
        throw new ExampleUploadError(
          `${file.name ?? 'An image'} could not be read as an image.`
        )
      }
      return {
        accountId,
        platform,
        source: 'upload' as VisualExampleSource,
        imageUrl: await storeExampleImage(n, accountId),
        postUrl: null,
        width: n.width,
        height: n.height
      }
    })
  )
  if (rows.length > 0) await db.insert(t).values(rows)
  return rows.length
}

/** Removes one example of the identity's; false when it is not theirs. */
export async function removeExample(
  accountId: string,
  exampleId: string
): Promise<boolean> {
  const t = visualExamplesTable
  const gone = await db
    .delete(t)
    .where(and(eq(t.id, exampleId), eq(t.accountId, accountId)))
    .returning({ imageUrl: t.imageUrl })
  await deleteStoredImages(gone.map(r => r.imageUrl))
  return gone.length > 0
}

/** Every example of the identity, oldest first, as the Profile page shows them. */
export async function exampleViews(
  accountId: string
): Promise<VisualExampleView[]> {
  const t = visualExamplesTable
  const rows = await db
    .select()
    .from(t)
    .where(eq(t.accountId, accountId))
    .orderBy(asc(t.createdAt))
  return Promise.all(
    rows.map(async row => ({
      id: row.id,
      platform: row.platform,
      source: row.source,
      url: await viewableImageUrl(row.imageUrl).catch(() => ''),
      postUrl: row.postUrl,
      width: row.width,
      height: row.height
    }))
  )
}

/**
 * The examples a new image for `platform` should follow, with their bytes:
 * that platform's own, else the identity's other platforms' (see
 * pickLookExamples). Empty when there are none or none can be read.
 */
export async function loadLookExamples(
  accountId: string,
  platform: PlatformId
): Promise<LookExample[]> {
  const t = visualExamplesTable
  const rows: Array<StoredExample & { id: string }> = await db
    .select({
      id: t.id,
      platform: t.platform,
      source: t.source,
      imageUrl: t.imageUrl,
      width: t.width,
      height: t.height,
      createdAt: t.createdAt
    })
    .from(t)
    .where(eq(t.accountId, accountId))
  const picked = pickLookExamples(rows, platform)
  const loaded = await Promise.all(
    picked.map(async row => {
      try {
        const bytes = await loadImageBytes(row.imageUrl)
        if (!bytes) return null
        const size =
          row.width && row.height
            ? { width: row.width, height: row.height }
            : await imageSize(bytes.buffer)
        return {
          id: row.id,
          platform: row.platform,
          source: row.source,
          data: bytes.buffer,
          mediaType: bytes.mediaType,
          width: size?.width ?? null,
          height: size?.height ?? null
        }
      } catch (err) {
        console.warn('An example image could not be loaded:', err)
        return null
      }
    })
  )
  return loaded.filter(e => e !== null)
}

/**
 * The looks of the account's latest images and carousels made like its
 * posts on `platform`, newest first: each image as it stands, each carousel
 * by its cover. `excludeDraftId` leaves out the post being made again,
 * whose own earlier images are told apart elsewhere.
 */
export async function loadRecentLooks(
  accountId: string,
  platform: PlatformId,
  options: { excludeDraftId?: string; limit?: number } = {}
): Promise<RecentLook[]> {
  const limit = options.limit ?? RECENT_LOOKS_SHOWN
  const d = postDraftsTable
  const ofPlatform = and(
    eq(d.accountId, accountId),
    eq(d.platform, platform),
    options.excludeDraftId ? ne(d.id, options.excludeDraftId) : undefined
  )
  const m = postMediaTable
  const s = postSlidesTable
  const [images, covers] = await Promise.all([
    db
      .select({
        look: sql<unknown>`${m.metadata}->'look'`,
        concept: m.promptOrQuery,
        at: m.createdAt
      })
      .from(m)
      .innerJoin(d, eq(m.draftId, d.id))
      .where(
        and(
          ofPlatform,
          eq(m.status, 'active'),
          sql`${m.metadata}->'look' is not null`
        )
      )
      .orderBy(desc(m.createdAt))
      .limit(limit),
    db
      .select({ look: sql<unknown>`${s.metadata}->'look'`, at: s.createdAt })
      .from(s)
      .innerJoin(d, eq(s.draftId, d.id))
      .where(
        and(ofPlatform, eq(s.position, 1), sql`${s.metadata}->'look' is not null`)
      )
      .orderBy(desc(s.createdAt))
      .limit(limit)
  ])
  return [
    ...images.map(r => ({
      at: r.at,
      look: recentLookOf(r.look, { carousel: false, concept: r.concept })
    })),
    ...covers.map(r => ({
      at: r.at,
      look: recentLookOf(r.look, { carousel: true })
    }))
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .flatMap(r => (r.look ? [r.look] : []))
    .slice(0, limit)
}
