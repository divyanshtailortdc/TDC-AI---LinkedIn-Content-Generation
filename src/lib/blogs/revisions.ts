import { blogRevisionsTable, blogsTable, type Blog } from '@/db/schema'
import { isUuid } from '@/lib/ids'
import { and, desc, eq } from 'drizzle-orm'
import type { BlogDb } from './claim'
import type { BlogReplacedBy, BlogSnapshot } from './types'

export type { BlogReplacedBy } from './types'

/**
 * Earlier versions of a blog. Every change that overwrites its text (a save,
 * a regenerate, a section rewrite, a restore) first saves the text it
 * replaces, inside the same transaction, so nothing written by the model or
 * the user is lost and a restore is itself undoable.
 */

/** Manual saves this close together keep one version between them. */
export const USER_EDIT_COALESCE_MS = 600_000

/**
 * Locks the blog's row for the rest of the transaction and returns it, so two
 * changes to one blog are applied one after the other.
 */
export async function lockBlog(
  tx: BlogDb,
  blogId: string
): Promise<Blog | undefined> {
  const [row] = await tx
    .select()
    .from(blogsTable)
    .where(eq(blogsTable.id, blogId))
    .for('update')
  return row
}

export function snapshotOf(blog: Blog): BlogSnapshot {
  return {
    title: blog.title,
    slug: blog.slug,
    metaTitle: blog.metaTitle,
    metaDescription: blog.metaDescription,
    primaryKeyword: blog.primaryKeyword,
    keywords: blog.keywords,
    searchIntent: blog.searchIntent,
    content: blog.content,
    faq: blog.faq,
    featuredImage: blog.featuredImage ?? null,
    wordCount: blog.wordCount
  }
}

/**
 * Saves `current` (the blog as it stands, from lockBlog) as its next earlier
 * version. Not when it has no text yet (a first generation), and not for a
 * manual save within USER_EDIT_COALESCE_MS of the last manual-save version.
 * True when it saved one.
 */
export async function saveBlogRevision(
  tx: BlogDb,
  current: Blog,
  replacedBy: BlogReplacedBy,
  options: { instruction?: string | null; now?: Date } = {}
): Promise<boolean> {
  if (current.wordCount === 0 && !current.title.trim()) return false
  const now = options.now ?? new Date()
  const [last] = await tx
    .select({
      number: blogRevisionsTable.number,
      replacedBy: blogRevisionsTable.replacedBy,
      createdAt: blogRevisionsTable.createdAt
    })
    .from(blogRevisionsTable)
    .where(eq(blogRevisionsTable.blogId, current.id))
    .orderBy(desc(blogRevisionsTable.number))
    .limit(1)
  if (
    replacedBy === 'user_edit' &&
    last?.replacedBy === 'user_edit' &&
    now.getTime() - last.createdAt.getTime() < USER_EDIT_COALESCE_MS
  ) {
    return false
  }
  await tx.insert(blogRevisionsTable).values({
    blogId: current.id,
    number: (last?.number ?? 0) + 1,
    replacedBy,
    instruction: options.instruction ?? null,
    snapshot: snapshotOf(current),
    createdAt: now
  })
  return true
}

/** A blog's earlier versions, newest first. */
export async function listBlogRevisions(database: BlogDb, blogId: string) {
  return database
    .select()
    .from(blogRevisionsTable)
    .where(eq(blogRevisionsTable.blogId, blogId))
    .orderBy(desc(blogRevisionsTable.number))
    .limit(50)
}

export async function findBlogRevision(
  database: BlogDb,
  blogId: string,
  revisionId: unknown
) {
  if (!isUuid(revisionId)) return undefined
  const [row] = await database
    .select()
    .from(blogRevisionsTable)
    .where(
      and(
        eq(blogRevisionsTable.id, revisionId),
        eq(blogRevisionsTable.blogId, blogId)
      )
    )
  return row
}
