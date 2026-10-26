import 'server-only'

import { db } from '@/db'
import {
  accountsTable,
  postDraftsTable,
  postVariantsTable,
  postCitationsTable,
  postMediaTable,
  ideasTable
} from '@/db/schema'
import { olderThan } from '@/lib/db-pagination'
import { FAILED_MEDIA_STATUS } from '@/lib/media/plan-record'
import { LOAD_BATCH_SIZE, pageOf } from '@/lib/pagination'
import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm'
import type { PostDetail } from './posts-client'

/** A run makes a handful of posts; this only bounds a pathological one. */
const RUN_POSTS_LIMIT = 500

/**
 * One page of an account's posts, newest first, with the variants, citation
 * counts and media each one shows in the queue. With `runId`, that run's posts
 * are included as well, wherever they fall.
 */
export async function loadPostsPage(
  accountId: string,
  options: { cursorId?: string | null; runId?: string | null } = {}
): Promise<{ posts: PostDetail[]; nextCursor: string | null }> {
  const columns = {
    id: postDraftsTable.id,
    accountId: postDraftsTable.accountId,
    hook: postDraftsTable.hook,
    originalHook: postDraftsTable.originalHook,
    body: postDraftsTable.body,
    cta: postDraftsTable.cta,
    firstComment: postDraftsTable.firstComment,
    hashtags: postDraftsTable.hashtags,
    charCount: postDraftsTable.charCount,
    status: postDraftsTable.status,
    lintFindings: postDraftsTable.lintFindings,
    createdAt: postDraftsTable.createdAt,
    accountName: accountsTable.name,
    accountHeadline: accountsTable.headline,
    runId: ideasTable.runId
  }
  const select = (where: SQL | undefined, limit: number) =>
    db
      .select(columns)
      .from(postDraftsTable)
      .leftJoin(accountsTable, eq(postDraftsTable.accountId, accountsTable.id))
      .leftJoin(ideasTable, eq(postDraftsTable.ideaId, ideasTable.id))
      .where(and(eq(postDraftsTable.accountId, accountId), where))
      .orderBy(desc(postDraftsTable.createdAt), desc(postDraftsTable.id))
      .limit(limit)

  const [pageRows, runRows] = await Promise.all([
    select(
      options.cursorId
        ? olderThan(
            postDraftsTable,
            postDraftsTable.createdAt,
            postDraftsTable.id,
            options.cursorId
          )
        : undefined,
      LOAD_BATCH_SIZE + 1
    ),
    // A run's posts are always included, however far back they are, so a run
    // opens complete. The newest page is loaded too, so leaving the run's view
    // (Clear filters) shows every post, not just that run's.
    options.runId && !options.cursorId
      ? select(eq(ideasTable.runId, options.runId), RUN_POSTS_LIMIT)
      : Promise.resolve([])
  ])

  const { items: page, nextCursor } = pageOf(pageRows)
  const onPage = new Set(page.map(row => row.id))
  const draftsRaw = [...page, ...runRows.filter(row => !onPage.has(row.id))].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1)
  )
  const draftIds = draftsRaw.map((d) => d.id)

  const [allVariants, allCitationCounts, allMedia, failedMedia] = await Promise.all([
    draftIds.length > 0
      ? db
          .select()
          .from(postVariantsTable)
          .where(inArray(postVariantsTable.draftId, draftIds))
      : Promise.resolve([]),
    // Only the queue's source-count badge reads citations, so only the count
    // is loaded; the rows themselves are not shown anywhere on this page.
    draftIds.length > 0
      ? db
          .select({ draftId: postCitationsTable.draftId, count: count() })
          .from(postCitationsTable)
          .where(inArray(postCitationsTable.draftId, draftIds))
          .groupBy(postCitationsTable.draftId)
      : Promise.resolve([]),
    // `image_url` can hold a base64 data URL of roughly half a megabyte per
    // image (when STORAGE_BUCKET is unset, and for rows not yet moved to it).
    // Selecting it for every draft pushed ~12 MB into this page's payload even
    // though only the selected post ever renders one, so it is fetched on demand.
    draftIds.length > 0
      ? db
          .select({
            id: postMediaTable.id,
            draftId: postMediaTable.draftId,
            version: postMediaTable.version,
            status: postMediaTable.status,
            mode: postMediaTable.mode,
            altText: postMediaTable.altText,
            promptOrQuery: postMediaTable.promptOrQuery,
            metadata: postMediaTable.metadata,
            regenerationAttempt: postMediaTable.regenerationAttempt,
            createdAt: postMediaTable.createdAt
          })
          .from(postMediaTable)
          .where(
            and(
              inArray(postMediaTable.draftId, draftIds),
              eq(postMediaTable.status, 'active')
            )
          )
          .orderBy(desc(postMediaTable.version), desc(postMediaTable.createdAt))
      : Promise.resolve([]),
    // An image drafting tried and failed to make: the review says why.
    draftIds.length > 0
      ? db
          .select({
            draftId: postMediaTable.draftId,
            metadata: postMediaTable.metadata
          })
          .from(postMediaTable)
          .where(
            and(
              inArray(postMediaTable.draftId, draftIds),
              eq(postMediaTable.status, FAILED_MEDIA_STATUS)
            )
          )
          .orderBy(desc(postMediaTable.createdAt))
      : Promise.resolve([])
  ])

  // Grouped once, so each post looks its own up instead of scanning every row.
  const variantsByDraft = new Map<string, typeof allVariants>()
  for (const v of allVariants) {
    variantsByDraft.set(v.draftId, [...(variantsByDraft.get(v.draftId) ?? []), v])
  }
  const citationCountByDraft = new Map(allCitationCounts.map((c) => [c.draftId, c.count]))
  // Newest version first, so the first row seen for a draft is the one to show.
  const mediaByDraft = new Map<string, (typeof allMedia)[number]>()
  for (const m of allMedia) if (!mediaByDraft.has(m.draftId)) mediaByDraft.set(m.draftId, m)
  const mediaFailureByDraft = new Map<string, string>()
  for (const f of failedMedia) {
    const error = (f.metadata as { error?: unknown } | null)?.error
    if (typeof error === 'string' && !mediaFailureByDraft.has(f.draftId)) {
      mediaFailureByDraft.set(f.draftId, error)
    }
  }

  const fullPosts: PostDetail[] = draftsRaw.map((draft) => {
    const variants = (variantsByDraft.get(draft.id) ?? []).map((v) => ({
      id: v.id,
      variantType: v.variantType,
      content: v.content
    }))

    const media = mediaByDraft.get(draft.id) || null

    return {
      id: draft.id,
      accountId: draft.accountId,
      accountName: draft.accountName || 'Unknown Identity',
      accountHeadline: draft.accountHeadline,
      hook: draft.hook,
      originalHook: draft.originalHook,
      body: draft.body,
      cta: draft.cta,
      firstComment: draft.firstComment,
      hashtags: (draft.hashtags as string[]) || [],
      charCount: draft.charCount,
      status: draft.status,
      createdAt: draft.createdAt,
      runId: draft.runId,
      variants,
      citationCount: citationCountByDraft.get(draft.id) ?? 0,
      media: media
        ? {
            id: media.id,
            version: media.version || 1,
            status: media.status || 'active',
            mode: media.mode,
            // Populated client-side when this post is opened.
            imageUrl: undefined,
            altText: media.altText,
            promptOrQuery: media.promptOrQuery,
            source: (media.metadata as any)?.source,
            workflow: (media.metadata as any)?.workflow,
            width: (media.metadata as any)?.width,
            height: (media.metadata as any)?.height,
            fallbackApplied: Boolean((media.metadata as any)?.fallbackApplied),
            visualType: (media.metadata as any)?.visualType,
            relevanceScore: (media.metadata as any)?.relevanceScore,
            relevanceExplanation: (media.metadata as any)?.relevanceExplanation,
            issues: (media.metadata as any)?.issues,
            mediaBrief: (media.metadata as any)?.mediaBrief,
            providerRequestId: (media.metadata as any)?.providerRequestId,
            seed: (media.metadata as any)?.seed,
            regenerationAttempt: media.regenerationAttempt || 0,
            hasLogo: Boolean((media.metadata as any)?.logo),
            reviewChecked: Boolean((media.metadata as any)?.review?.checked),
            usedReference: Boolean((media.metadata as any)?.usedReference)
          }
        : null,
      mediaFailure: media ? null : (mediaFailureByDraft.get(draft.id) ?? null),
      lintFindings: (draft.lintFindings as any[]) || []
    }
  })

  return { posts: fullPosts, nextCursor }
}

export async function countPosts(accountId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(postDraftsTable)
    .where(eq(postDraftsTable.accountId, accountId))
  return row?.total ?? 0
}
