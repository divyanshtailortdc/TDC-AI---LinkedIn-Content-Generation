import { blogsTable } from '@/db/schema'
import { isUuid } from '@/lib/ids'
import { and, eq, isNull, lt, ne, or } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import { addUsage, type CallUsage } from '~/lib/ai/usage'
import type { LintFinding } from '~/lib/lint/run-linter'
import type { BlogDoc } from './doc'
import { lockBlog, saveBlogRevision } from './revisions'
import {
  BLOG_GENERATION_STALE_MS,
  type BlogBrief,
  type BlogGenerationStage,
  type BlogImage,
  type BlogKind,
  type BlogPlan,
  type BlogSource,
  type BlogVerification,
  type FaqItem,
  type FeaturedImage,
  type InternalLink,
  type SearchIntent,
  type SearchQuestion
} from './types'

/**
 * One generation of a blog at a time. Starting one (a new blog, Try again, a
 * regenerate) first claims the row with a conditional write, and only the
 * caller that gets the claim calls the model, so a double click, two tabs or
 * a retry never pay for a second generation:
 *
 *   createClaimedBlog     inserts the blog as `generating` under the id the
 *                         form made, so a resent request creates nothing new.
 *   claimBlogGeneration   ready / failed / stale → generating.
 *   saveGeneratedBlog     writes the result only while the claim still holds
 *                         (the same generation_started_at), keeping the
 *                         version it replaces.
 *   failBlogGeneration    records why it failed, under the same rule.
 *
 * The claim's token is its generation_started_at. Takes the database as an
 * argument so it can run on any connection (and in tests).
 */
export type BlogDb = PgDatabase<PostgresJsQueryResultHKT, any, any>

export type BlogClaim = { blogId: string; claimedAt: Date }

/** What a generation writes. */
export type GeneratedBlog = {
  title: string
  slug: string
  metaTitle: string
  metaDescription: string
  primaryKeyword: string
  keywords: string[]
  content: BlogDoc
  faq: FaqItem[]
  sources: BlogSource[]
  wordCount: number
  checks: LintFinding[]
  selfFlags: string[]
  /** What this generation cost; added to the blog's total. */
  usage: CallUsage
  model: string | null
  searchIntent: SearchIntent | ''
  plan: BlogPlan | null
  /** The new featured image (or failure), null for none, 'keep' to leave it. */
  featuredImage: FeaturedImage | null | 'keep'
  verification: BlogVerification | null
  internalLinks: InternalLink[]
  /** The questions people search that it was planned with. */
  searchQuestions: SearchQuestion[]
  /** Pictures made by this generation, added to the blog's list. */
  newImages: BlogImage[]
}

/** Not generating, or generating under a claim that went stale. */
const claimable = (now: Date) =>
  or(
    ne(blogsTable.generationStatus, 'generating'),
    isNull(blogsTable.generationStartedAt),
    lt(
      blogsTable.generationStartedAt,
      new Date(now.getTime() - BLOG_GENERATION_STALE_MS)
    )
  )

/** The claim still holds: generating, under this claim's token. */
const holds = (
  claim: BlogClaim,
  row: { generationStatus: string; generationStartedAt: Date | null }
) =>
  row.generationStatus === 'generating' &&
  row.generationStartedAt?.getTime() === claim.claimedAt.getTime()

/**
 * A new blog, claimed for its first generation. `created`: this caller
 * generates it. `exists`: a request with this id already made it (a double
 * click). `taken`: the id belongs to another identity's blog.
 */
export async function createClaimedBlog(
  database: BlogDb,
  values: {
    id: string
    accountId: string
    ideaId: string | null
    goalId: string | null
    kind: BlogKind
    brief: BlogBrief
    title?: string
  },
  now: Date = new Date()
): Promise<
  | { outcome: 'created'; claim: BlogClaim }
  | { outcome: 'exists'; blogId: string }
  | { outcome: 'taken' }
> {
  const inserted = await database
    .insert(blogsTable)
    .values({
      id: values.id,
      accountId: values.accountId,
      ideaId: values.ideaId,
      goalId: values.goalId,
      kind: values.kind,
      brief: values.brief,
      title: values.title ?? '',
      generationStatus: 'generating',
      generationStartedAt: now,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoNothing({ target: blogsTable.id })
    .returning({ id: blogsTable.id })
  if (inserted.length > 0) {
    return { outcome: 'created', claim: { blogId: values.id, claimedAt: now } }
  }
  const [existing] = await database
    .select({ accountId: blogsTable.accountId })
    .from(blogsTable)
    .where(eq(blogsTable.id, values.id))
  return existing?.accountId === values.accountId
    ? { outcome: 'exists', blogId: values.id }
    : { outcome: 'taken' }
}

/**
 * Claims the identity's blog for a new generation, unless one is already
 * running (and not stale). Null when it is, or when the blog is not the
 * identity's.
 */
export async function claimBlogGeneration(
  database: BlogDb,
  ref: { accountId: string; blogId: string },
  now: Date = new Date()
): Promise<BlogClaim | null> {
  if (!isUuid(ref.blogId)) return null
  const [row] = await database
    .update(blogsTable)
    .set({
      generationStatus: 'generating',
      generationStartedAt: now,
      generationStage: null,
      generationError: null,
      updatedAt: now
    })
    .where(
      and(
        eq(blogsTable.id, ref.blogId),
        eq(blogsTable.accountId, ref.accountId),
        claimable(now)
      )
    )
    .returning({ id: blogsTable.id })
  return row ? { blogId: row.id, claimedAt: now } : null
}

/** What the running generation is doing, for the progress view. */
export async function setBlogStage(
  database: BlogDb,
  claim: BlogClaim,
  stage: BlogGenerationStage
): Promise<boolean> {
  const rows = await database
    .update(blogsTable)
    .set({ generationStage: stage })
    .where(
      and(
        eq(blogsTable.id, claim.blogId),
        eq(blogsTable.generationStatus, 'generating'),
        eq(blogsTable.generationStartedAt, claim.claimedAt)
      )
    )
    .returning({ id: blogsTable.id })
  return rows.length > 0
}

/**
 * Writes a finished generation, while the claim still holds. With
 * `keepRevision`, the text it replaces is kept as an earlier version first
 * (nothing is kept for a blog with no text yet).
 */
export async function saveGeneratedBlog(
  database: BlogDb,
  claim: BlogClaim,
  result: GeneratedBlog,
  options: { keepRevision: boolean; instruction: string | null },
  now: Date = new Date()
): Promise<boolean> {
  return database.transaction(async tx => {
    const row = await lockBlog(tx, claim.blogId)
    if (!row || !holds(claim, row)) return false
    if (options.keepRevision) {
      await saveBlogRevision(tx, row, 'regenerate', {
        instruction: options.instruction,
        now
      })
    }
    await tx
      .update(blogsTable)
      .set({
        title: result.title,
        slug: result.slug,
        metaTitle: result.metaTitle,
        metaDescription: result.metaDescription,
        primaryKeyword: result.primaryKeyword,
        keywords: result.keywords,
        content: result.content,
        faq: result.faq,
        sources: result.sources,
        wordCount: result.wordCount,
        checks: result.checks,
        selfFlags: result.selfFlags,
        usage: addUsage(row.usage, result.usage),
        model: result.model,
        searchIntent: result.searchIntent,
        plan: result.plan,
        ...(result.featuredImage !== 'keep' && {
          featuredImage: result.featuredImage
        }),
        verification: result.verification,
        internalLinks: result.internalLinks,
        searchQuestions: result.searchQuestions,
        ...(result.newImages.length > 0 && {
          images: [...(row.images ?? []), ...result.newImages]
        }),
        generationStatus: 'ready',
        generationStage: null,
        generationError: null,
        generatedAt: now,
        lockVersion: row.lockVersion + 1,
        updatedAt: now
      })
      .where(eq(blogsTable.id, row.id))
    return true
  })
}

/**
 * Records why a generation failed and what it cost, while the claim still
 * holds. A featured image finished before the failure is kept (it was paid
 * for), so a retry need not make it again; section pictures made are added
 * to the list (no text names them yet, but the files are kept with it).
 * So is the research of a blog not yet written: its brief cannot change, so
 * a retry reads the same sources and questions instead of paying the
 * research agent again. A written blog keeps the sources its text cites.
 */
export async function failBlogGeneration(
  database: BlogDb,
  claim: BlogClaim,
  message: string,
  usage: CallUsage,
  now: Date = new Date(),
  kept: {
    featuredImage?: FeaturedImage | null
    images?: BlogImage[]
    sources?: BlogSource[]
    searchQuestions?: SearchQuestion[]
  } = {}
): Promise<boolean> {
  return database.transaction(async tx => {
    const row = await lockBlog(tx, claim.blogId)
    if (!row || !holds(claim, row)) return false
    const unwritten = row.wordCount === 0 && row.title.trim() === ''
    await tx
      .update(blogsTable)
      .set({
        generationStatus: 'failed',
        generationStage: null,
        generationError: message,
        usage: addUsage(row.usage, usage),
        ...(kept.featuredImage?.status === 'ready' && {
          featuredImage: kept.featuredImage
        }),
        ...(kept.images?.length && {
          images: [...(row.images ?? []), ...kept.images]
        }),
        ...(unwritten && kept.sources?.length && { sources: kept.sources }),
        ...(unwritten &&
          kept.searchQuestions?.length && {
            searchQuestions: kept.searchQuestions
          }),
        updatedAt: now
      })
      .where(eq(blogsTable.id, row.id))
    return true
  })
}
