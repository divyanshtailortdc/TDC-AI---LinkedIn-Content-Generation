import { blogsTable, type Blog } from '@/db/schema'
import { isUuid } from '@/lib/ids'
import { and, eq } from 'drizzle-orm'
import { addUsage, type CallUsage } from '~/lib/ai/usage'
import type { LintFinding } from '~/lib/lint/run-linter'
import type { BlogDb } from './claim'
import { DEFAULT_BLOG_DESTINATION, type BlogDestinationId } from './destinations'
import type { BlogDoc } from './doc'
import type { BlogEdit } from './input'
import { findBlogRevision, lockBlog, saveBlogRevision } from './revisions'
import {
  isGenerationStale,
  type BlogSnapshot,
  type BlogSource,
  type BlogVerification,
  type FeaturedImage
} from './types'

/**
 * Changes to a blog made from its page: saves, section rewrites, restores,
 * publishing and deleting. Each acts only on the given identity's blog (any
 * other is "not found"), never while a generation runs, and keeps the text
 * it replaces as an earlier version. Saves and rewrites carry the
 * `lock_version` the page loaded, so a stale tab cannot overwrite newer text.
 */

export type SaveOutcome =
  | { ok: true; blog: Blog }
  | { ok: false; reason: 'not_found' | 'generating' | 'conflict' }

export async function findIdentityBlog(
  database: BlogDb,
  accountId: string,
  blogId: unknown
): Promise<Blog | undefined> {
  if (!isUuid(blogId)) return undefined
  const [row] = await database
    .select()
    .from(blogsTable)
    .where(and(eq(blogsTable.id, blogId), eq(blogsTable.accountId, accountId)))
    .limit(1)
  return row
}

/** The identity's blog, locked; undefined for any other. */
async function lockOwned(tx: BlogDb, accountId: string, blogId: string) {
  if (!isUuid(blogId)) return undefined
  const row = await lockBlog(tx, blogId)
  return row?.accountId === accountId ? row : undefined
}

/**
 * A generation still running (and not stale) owns the blog: no other change
 * is applied until it ends.
 */
const isRunning = (row: Blog, now: Date) =>
  row.generationStatus === 'generating' &&
  !isGenerationStale(row, now.getTime())

/**
 * A failed or stopped regeneration left the text as it was; changing the text
 * settles the blog as ready (a stopped run's claim no longer holds, so it can
 * never write over this change).
 */
const settled = (row: Blog) =>
  row.generationStatus === 'ready'
    ? {}
    : {
        generationStatus: 'ready' as const,
        generationStage: null,
        generationError: null
      }

export async function saveBlogEdit(
  database: BlogDb,
  input: {
    accountId: string
    blogId: string
    lockVersion: number
    edit: BlogEdit
    wordCount: number
    checks: LintFinding[]
    now?: Date
  }
): Promise<SaveOutcome> {
  const now = input.now ?? new Date()
  return database.transaction(async (tx): Promise<SaveOutcome> => {
    const row = await lockOwned(tx, input.accountId, input.blogId)
    if (!row) return { ok: false, reason: 'not_found' }
    if (isRunning(row, now)) return { ok: false, reason: 'generating' }
    if (row.lockVersion !== input.lockVersion)
      return { ok: false, reason: 'conflict' }
    await saveBlogRevision(tx, row, 'user_edit', { now })
    const { featuredAlt, featuredCaption, ...text } = input.edit
    const image = row.featuredImage
    const [blog] = await tx
      .update(blogsTable)
      .set({
        ...text,
        // The image's words are edited with the text; the image itself is not.
        ...(image?.status === 'ready' && {
          featuredImage: { ...image, alt: featuredAlt, caption: featuredCaption }
        }),
        ...(image?.status === 'failed' && {
          featuredImage: { ...image, alt: featuredAlt }
        }),
        wordCount: input.wordCount,
        checks: input.checks,
        ...settled(row),
        lockVersion: row.lockVersion + 1,
        updatedAt: now
      })
      .where(eq(blogsTable.id, row.id))
      .returning()
    return { ok: true, blog: blog! }
  })
}

export async function applySectionRewrite(
  database: BlogDb,
  input: {
    accountId: string
    blogId: string
    lockVersion: number
    content: BlogDoc
    sources: BlogSource[]
    wordCount: number
    checks: LintFinding[]
    usage: CallUsage
    instruction: string | null
    /** The citations as checked after the rewrite; absent leaves them. */
    verification?: BlogVerification | null
    now?: Date
  }
): Promise<SaveOutcome> {
  const now = input.now ?? new Date()
  return database.transaction(async (tx): Promise<SaveOutcome> => {
    const row = await lockOwned(tx, input.accountId, input.blogId)
    if (!row) return { ok: false, reason: 'not_found' }
    if (isRunning(row, now)) return { ok: false, reason: 'generating' }
    if (row.lockVersion !== input.lockVersion)
      return { ok: false, reason: 'conflict' }
    await saveBlogRevision(tx, row, 'section_rewrite', {
      instruction: input.instruction,
      now
    })
    const [blog] = await tx
      .update(blogsTable)
      .set({
        content: input.content,
        sources: input.sources,
        wordCount: input.wordCount,
        checks: input.checks,
        ...(input.verification !== undefined && {
          verification: input.verification
        }),
        usage: addUsage(row.usage, input.usage),
        ...settled(row),
        lockVersion: row.lockVersion + 1,
        updatedAt: now
      })
      .where(eq(blogsTable.id, row.id))
      .returning()
    return { ok: true, blog: blog! }
  })
}

/** Puts an earlier version back, keeping the text it replaces as a version too. */
export async function restoreBlogRevision(
  database: BlogDb,
  input: {
    accountId: string
    blogId: string
    revisionId: string
    checksFor: (snapshot: BlogSnapshot) => LintFinding[]
    now?: Date
  }
): Promise<SaveOutcome | { ok: false; reason: 'version_not_found' }> {
  const now = input.now ?? new Date()
  return database.transaction(
    async (
      tx
    ): Promise<SaveOutcome | { ok: false; reason: 'version_not_found' }> => {
      const row = await lockOwned(tx, input.accountId, input.blogId)
      if (!row) return { ok: false, reason: 'not_found' }
      if (isRunning(row, now)) return { ok: false, reason: 'generating' }
      const revision = await findBlogRevision(tx, row.id, input.revisionId)
      if (!revision) return { ok: false, reason: 'version_not_found' }
      await saveBlogRevision(tx, row, 'restore', { now })
      const snapshot = revision.snapshot
      const [blog] = await tx
        .update(blogsTable)
        .set({
          title: snapshot.title,
          slug: snapshot.slug,
          metaTitle: snapshot.metaTitle,
          metaDescription: snapshot.metaDescription,
          primaryKeyword: snapshot.primaryKeyword,
          keywords: snapshot.keywords,
          // Versions saved before these existed leave them as they are.
          ...(snapshot.searchIntent !== undefined && {
            searchIntent: snapshot.searchIntent
          }),
          ...(snapshot.featuredImage !== undefined && {
            featuredImage: snapshot.featuredImage
          }),
          content: snapshot.content,
          faq: snapshot.faq,
          wordCount: snapshot.wordCount,
          checks: input.checksFor(snapshot),
          ...settled(row),
          lockVersion: row.lockVersion + 1,
          updatedAt: now
        })
        .where(eq(blogsTable.id, row.id))
        .returning()
      return { ok: true, blog: blog! }
    }
  )
}

/**
 * Sets the blog's featured image (a new one, a failed attempt, or none),
 * keeping the one it replaces as a version so Restore can bring it back. The
 * text is untouched, but the lock version moves on: an editor that saves
 * after this reloads first rather than losing the image's alt text.
 */
export async function setFeaturedImage(
  database: BlogDb,
  input: {
    accountId: string
    blogId: string
    image: FeaturedImage | null
    usage?: CallUsage
    now?: Date
  }
): Promise<SaveOutcome> {
  const now = input.now ?? new Date()
  return database.transaction(async (tx): Promise<SaveOutcome> => {
    const row = await lockOwned(tx, input.accountId, input.blogId)
    if (!row) return { ok: false, reason: 'not_found' }
    if (isRunning(row, now)) return { ok: false, reason: 'generating' }
    if (row.featuredImage?.status === 'ready') {
      await saveBlogRevision(tx, row, 'image', { now })
    }
    const [blog] = await tx
      .update(blogsTable)
      .set({
        featuredImage: input.image,
        ...(input.usage && { usage: addUsage(row.usage, input.usage) }),
        lockVersion: row.lockVersion + 1,
        updatedAt: now
      })
      .where(eq(blogsTable.id, row.id))
      .returning()
    return { ok: true, blog: blog! }
  })
}

/**
 * Records a check of the blog's sources: the verdicts and the checks they
 * change. The text is untouched, so the lock version stays and no version
 * is kept; a check of an older lock version is refused.
 */
export async function setBlogVerification(
  database: BlogDb,
  input: {
    accountId: string
    blogId: string
    lockVersion: number
    verification: BlogVerification
    checks: LintFinding[]
    usage: CallUsage
    now?: Date
  }
): Promise<SaveOutcome> {
  const now = input.now ?? new Date()
  return database.transaction(async (tx): Promise<SaveOutcome> => {
    const row = await lockOwned(tx, input.accountId, input.blogId)
    if (!row) return { ok: false, reason: 'not_found' }
    if (isRunning(row, now)) return { ok: false, reason: 'generating' }
    if (row.lockVersion !== input.lockVersion)
      return { ok: false, reason: 'conflict' }
    const [blog] = await tx
      .update(blogsTable)
      .set({
        verification: input.verification,
        checks: input.checks,
        usage: addUsage(row.usage, input.usage),
        updatedAt: now
      })
      .where(eq(blogsTable.id, row.id))
      .returning()
    return { ok: true, blog: blog! }
  })
}

/**
 * Marks the blog published, with where it went (a CMS destination, the
 * identity's own website when not said), its live page and when it went out
 * (now when not said), or back to a draft, which clears all three. Its text
 * is untouched, so an open editor's lock version stays valid. Marking by hand
 * and a future CMS integration both record a publication through here
 * (src/lib/blogs/destinations.ts).
 */
export async function setBlogPublished(
  database: BlogDb,
  input: {
    accountId: string
    blogId: string
    published: boolean
    url: string | null
    destination?: BlogDestinationId | null
    publishedAt?: Date | null
    now?: Date
  }
): Promise<SaveOutcome> {
  if (!isUuid(input.blogId)) return { ok: false, reason: 'not_found' }
  const now = input.now ?? new Date()
  const [blog] = await database
    .update(blogsTable)
    .set(
      input.published
        ? {
            status: 'published',
            publishedTo: input.destination ?? DEFAULT_BLOG_DESTINATION,
            publishedUrl: input.url,
            publishedAt: input.publishedAt ?? now,
            updatedAt: now
          }
        : {
            status: 'draft',
            publishedTo: null,
            publishedUrl: null,
            publishedAt: null,
            updatedAt: now
          }
    )
    .where(
      and(
        eq(blogsTable.id, input.blogId),
        eq(blogsTable.accountId, input.accountId)
      )
    )
    .returning()
  return blog ? { ok: true, blog } : { ok: false, reason: 'not_found' }
}

export async function deleteIdentityBlog(
  database: BlogDb,
  accountId: string,
  blogId: string
): Promise<boolean> {
  if (!isUuid(blogId)) return false
  const rows = await database
    .delete(blogsTable)
    .where(and(eq(blogsTable.id, blogId), eq(blogsTable.accountId, accountId)))
    .returning({ id: blogsTable.id })
  return rows.length > 0
}
