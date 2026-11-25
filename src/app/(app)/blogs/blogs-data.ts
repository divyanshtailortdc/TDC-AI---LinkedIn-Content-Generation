import 'server-only'

import { db } from '@/db'
import {
  accountsTable,
  audiencesTable,
  blogsTable,
  brandThemesTable,
  goalsTable,
  ideasTable,
  knowledgeDocumentsTable,
  type Blog
} from '@/db/schema'
import { isAICapable } from '@/lib/ai'
import type { BlogDestinationId } from '@/lib/blogs/destinations'
import type { BlogDoc } from '@/lib/blogs/doc'
import { searchResultHost } from '@/lib/blogs/seo'
import { findIdentityBlog } from '@/lib/blogs/store'
import {
  BLOG_KIND_DEFAULTS,
  BLOG_LIMITS,
  isGenerationStale,
  type BlogBrief,
  type BlogGenerationStage,
  type BlogGenerationStatus,
  type BlogKind,
  type BlogPlan,
  type BlogSource,
  type BlogStatus,
  type BlogVerification,
  type FaqItem,
  type FeaturedImage,
  type InternalLink,
  type RelatedDraft,
  type SearchIntent
} from '@/lib/blogs/types'
import { DEFAULT_PRIMARY, resolveBrandTheme } from '@/lib/brand/theme'
import { viewableImageUrl } from '@/lib/media/image-store'
import { isUuid } from '@/lib/ids'
import type { LintFinding } from '@/lib/lint/run-linter'
import { isWebSearchConfigured } from '@/lib/research/web-search'
import { and, asc, count, desc, eq } from 'drizzle-orm'

/** One row of the Blogs & Articles list. */
export type BlogListItem = {
  id: string
  title: string
  topic: string
  kind: BlogKind
  status: BlogStatus
  generationStatus: BlogGenerationStatus
  generationStage: BlogGenerationStage | null
  generationError: string | null
  /** Generating, but its claim went stale: it stopped. */
  stale: boolean
  wordCount: number
  primaryKeyword: string
  publishedUrl: string | null
  /** Where it went out, when it is published and that was recorded. */
  publishedTo: BlogDestinationId | null
  publishedAt: string | null
  updatedAt: string
}

/** The identity's blogs, newest change first. */
export async function loadBlogList(accountId: string): Promise<BlogListItem[]> {
  const rows = await db
    .select({
      id: blogsTable.id,
      title: blogsTable.title,
      brief: blogsTable.brief,
      kind: blogsTable.kind,
      status: blogsTable.status,
      generationStatus: blogsTable.generationStatus,
      generationStage: blogsTable.generationStage,
      generationError: blogsTable.generationError,
      generationStartedAt: blogsTable.generationStartedAt,
      wordCount: blogsTable.wordCount,
      primaryKeyword: blogsTable.primaryKeyword,
      publishedUrl: blogsTable.publishedUrl,
      publishedTo: blogsTable.publishedTo,
      publishedAt: blogsTable.publishedAt,
      updatedAt: blogsTable.updatedAt
    })
    .from(blogsTable)
    .where(eq(blogsTable.accountId, accountId))
    .orderBy(desc(blogsTable.updatedAt))
    .limit(100)
  const now = Date.now()
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    topic: row.brief.topic,
    kind: row.kind,
    status: row.status,
    generationStatus: row.generationStatus,
    generationStage: row.generationStage ?? null,
    generationError: row.generationError,
    stale: isGenerationStale(row, now),
    wordCount: row.wordCount,
    primaryKeyword: row.primaryKeyword || row.brief.primaryKeyword,
    publishedUrl: row.publishedUrl,
    publishedTo: row.publishedTo ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString()
  }))
}

/** A blog as the editor holds it: plain data, dates as ISO strings. */
export type BlogEditorBlog = {
  id: string
  kind: BlogKind
  status: BlogStatus
  generationStatus: BlogGenerationStatus
  generationStage: BlogGenerationStage | null
  generationError: string | null
  generationStartedAt: string | null
  stale: boolean
  brief: BlogBrief
  title: string
  slug: string
  metaTitle: string
  metaDescription: string
  primaryKeyword: string
  keywords: string[]
  searchIntent: SearchIntent | ''
  content: BlogDoc
  faq: FaqItem[]
  sources: BlogSource[]
  wordCount: number
  checks: LintFinding[]
  selfFlags: string[]
  costUsd: number
  model: string | null
  lockVersion: number
  publishedUrl: string | null
  publishedAt: string | null
  publishedTo: BlogDestinationId | null
  updatedAt: string
  ideaId: string | null
  goalId: string | null
  plan: BlogPlan | null
  verification: BlogVerification | null
  internalLinks: InternalLink[]
  featuredImage: FeaturedImage | null
  /** A link the browser can load for the featured image (signed), or null. */
  featuredImageUrl: string | null
}

/**
 * A blog as the editor holds it. The featured image's link is signed on the
 * server, so the sync form leaves it to editorBlogOf.
 */
export function toEditorBlog(
  blog: Blog,
  now: number = Date.now(),
  featuredImageUrl: string | null = null
): BlogEditorBlog {
  return {
    id: blog.id,
    kind: blog.kind,
    status: blog.status,
    generationStatus: blog.generationStatus,
    generationStage: blog.generationStage ?? null,
    generationError: blog.generationError,
    generationStartedAt: blog.generationStartedAt?.toISOString() ?? null,
    stale: isGenerationStale(blog, now),
    // Briefs made before case studies existed have no case details.
    brief: { ...blog.brief, caseDetails: blog.brief.caseDetails ?? '' },
    title: blog.title,
    slug: blog.slug,
    metaTitle: blog.metaTitle,
    metaDescription: blog.metaDescription,
    primaryKeyword: blog.primaryKeyword,
    keywords: blog.keywords,
    searchIntent: blog.searchIntent ?? '',
    content: blog.content,
    faq: blog.faq,
    sources: blog.sources,
    wordCount: blog.wordCount,
    checks: blog.checks,
    selfFlags: blog.selfFlags,
    costUsd: Number(blog.usage?.costUsd ?? 0),
    model: blog.model,
    lockVersion: blog.lockVersion,
    publishedUrl: blog.publishedUrl,
    publishedAt: blog.publishedAt?.toISOString() ?? null,
    publishedTo: blog.publishedTo ?? null,
    updatedAt: blog.updatedAt.toISOString(),
    ideaId: blog.ideaId,
    goalId: blog.goalId,
    plan: blog.plan ?? null,
    verification: blog.verification ?? null,
    internalLinks: blog.internalLinks ?? [],
    featuredImage: blog.featuredImage ?? null,
    featuredImageUrl
  }
}

/** The editor's copy of a blog, with a link the browser can load for its image. */
export async function editorBlogOf(blog: Blog): Promise<BlogEditorBlog> {
  const image = blog.featuredImage
  const url =
    image?.status === 'ready'
      ? await viewableImageUrl(image.src).catch(error => {
          console.warn(`Could not sign the image of blog ${blog.id}:`, error)
          return null
        })
      : null
  return toEditorBlog(blog, Date.now(), url)
}

export type BlogLabels = {
  idea: string | null
  goal: string | null
  audience: string | null
  /** The identity's site as search results show it, e.g. "tdccommerce.com". */
  site: string | null
  /** The identity's name and site, for an exported page's author and publisher. */
  author: { name: string; url: string | null; type: 'Organization' | 'Person' }
  /** The brand's main colour, for diagrams. */
  brandColor: string
  /** The identity's other drafts: worth linking once they are published. */
  related: RelatedDraft[]
}

/** The identity's blog for its page, with the names of what it was made from. */
export async function loadBlogEditor(
  accountId: string,
  blogId: string
): Promise<{ blog: BlogEditorBlog; labels: BlogLabels } | null> {
  const blog = await findIdentityBlog(db, accountId, blogId)
  if (!blog) return null
  const audienceId = blog.brief.audience.audienceId
  const [idea, goal, audience, account, theme, others] = await Promise.all([
    blog.ideaId
      ? db.query.ideasTable.findFirst({
          columns: { title: true, hook: true },
          where: and(
            eq(ideasTable.id, blog.ideaId),
            eq(ideasTable.accountId, accountId)
          )
        })
      : undefined,
    blog.goalId
      ? db.query.goalsTable.findFirst({
          columns: { title: true },
          where: and(
            eq(goalsTable.id, blog.goalId),
            eq(goalsTable.accountId, accountId)
          )
        })
      : undefined,
    audienceId && isUuid(audienceId)
      ? db.query.audiencesTable.findFirst({
          columns: { name: true },
          where: and(
            eq(audiencesTable.id, audienceId),
            eq(audiencesTable.accountId, accountId)
          )
        })
      : undefined,
    db.query.accountsTable.findFirst({
      columns: { websiteUrl: true, name: true, accountType: true },
      where: eq(accountsTable.id, accountId)
    }),
    db.query.brandThemesTable.findFirst({
      where: eq(brandThemesTable.accountId, accountId)
    }),
    db
      .select({
        id: blogsTable.id,
        title: blogsTable.title,
        status: blogsTable.status,
        publishedUrl: blogsTable.publishedUrl
      })
      .from(blogsTable)
      .where(eq(blogsTable.accountId, accountId))
      .orderBy(desc(blogsTable.updatedAt))
      .limit(40)
  ])
  const website = account?.websiteUrl?.trim() || null
  return {
    blog: await editorBlogOf(blog),
    labels: {
      idea: idea ? idea.title || idea.hook : null,
      goal: goal?.title ?? null,
      audience: audience?.name ?? null,
      site: searchResultHost(account?.websiteUrl),
      author: {
        name: account?.name ?? '',
        url: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
        type: account?.accountType === 'company' ? 'Organization' : 'Person'
      },
      brandColor: resolveBrandTheme(theme ?? null).primaryColor ?? DEFAULT_PRIMARY,
      related: others
        .filter(
          other =>
            other.id !== blog.id &&
            other.title.trim() &&
            !(other.status === 'published' && other.publishedUrl)
        )
        .slice(0, 10)
        .map(other => ({ blogId: other.id, title: other.title }))
    }
  }
}

/** What the New blog form offers, and what it starts from. */
export type NewBlogOptions = {
  audiences: Array<{ id: string; name: string }>
  goals: Array<{ id: string; title: string }>
  knowledgeCount: number
  researchAvailable: boolean
  aiAvailable: boolean
  /** An idea (?idea=) or an earlier blog's brief (?from=) to start from. */
  prefill: {
    kind: BlogKind
    brief: Partial<BlogBrief>
    goalId: string | null
    ideaId: string | null
    ideaTitle: string | null
  } | null
}

export async function loadNewBlogOptions(
  accountId: string,
  from: { ideaId?: string | null; blogId?: string | null } = {}
): Promise<NewBlogOptions> {
  const [audiences, goals, [knowledge], idea, earlier] = await Promise.all([
    db
      .select({ id: audiencesTable.id, name: audiencesTable.name })
      .from(audiencesTable)
      .where(eq(audiencesTable.accountId, accountId))
      .orderBy(asc(audiencesTable.createdAt)),
    db
      .select({ id: goalsTable.id, title: goalsTable.title })
      .from(goalsTable)
      .where(
        and(eq(goalsTable.accountId, accountId), eq(goalsTable.isActive, true))
      )
      .orderBy(desc(goalsTable.createdAt)),
    db
      .select({ value: count() })
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.accountId, accountId)),
    from.ideaId && isUuid(from.ideaId)
      ? db.query.ideasTable.findFirst({
          where: and(
            eq(ideasTable.id, from.ideaId),
            eq(ideasTable.accountId, accountId)
          )
        })
      : undefined,
    from.blogId ? findIdentityBlog(db, accountId, from.blogId) : undefined
  ])

  let prefill: NewBlogOptions['prefill'] = null
  if (idea) {
    const title = idea.title || idea.hook
    const topic = [title, idea.angle]
      .filter(Boolean)
      .join(': ')
      .slice(0, BLOG_LIMITS.topic)
    prefill = {
      kind: 'blog',
      brief: { topic },
      goalId:
        idea.goalId && goals.some(g => g.id === idea.goalId)
          ? idea.goalId
          : null,
      ideaId: idea.id,
      ideaTitle: title
    }
  } else if (earlier) {
    prefill = {
      kind: earlier.kind,
      brief: { ...earlier.brief },
      goalId:
        earlier.goalId && goals.some(g => g.id === earlier.goalId)
          ? earlier.goalId
          : null,
      ideaId: null,
      ideaTitle: null
    }
  }

  return {
    audiences,
    goals,
    knowledgeCount: Number(knowledge?.value ?? 0),
    researchAvailable: isWebSearchConfigured,
    aiAvailable: isAICapable,
    prefill: prefill && {
      ...prefill,
      brief: {
        length: BLOG_KIND_DEFAULTS[prefill.kind].length,
        faq: BLOG_KIND_DEFAULTS[prefill.kind].faq,
        ...prefill.brief
      }
    }
  }
}
