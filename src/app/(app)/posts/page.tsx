import { db } from '@/db'
import {
  accountsTable,
  postDraftsTable,
  postVariantsTable,
  postCitationsTable,
  postMediaTable,
  ideasTable
} from '@/db/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { PostsClient, type PostDetail } from './posts-client'

export const dynamic = 'force-dynamic'

export default async function PostsPage() {
  const [draftsRaw, accounts] = await Promise.all([
    db
      .select({
        id: postDraftsTable.id,
        accountId: postDraftsTable.accountId,
        hook: postDraftsTable.hook,
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
      })
      .from(postDraftsTable)
      .leftJoin(accountsTable, eq(postDraftsTable.accountId, accountsTable.id))
      .leftJoin(ideasTable, eq(postDraftsTable.ideaId, ideasTable.id))
      .orderBy(desc(postDraftsTable.createdAt)),
    db
      .select({
        id: accountsTable.id,
        name: accountsTable.name
      })
      .from(accountsTable)
  ])

  const draftIds = draftsRaw.map((d) => d.id)

  const [allVariants, allCitations, allMedia] = await Promise.all([
    draftIds.length > 0
      ? db
          .select()
          .from(postVariantsTable)
          .where(inArray(postVariantsTable.draftId, draftIds))
      : Promise.resolve([]),
    draftIds.length > 0
      ? db
          .select()
          .from(postCitationsTable)
          .where(inArray(postCitationsTable.draftId, draftIds))
      : Promise.resolve([]),
    // `image_url` holds a base64 data URL of roughly half a megabyte per image.
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
      : Promise.resolve([])
  ])

  const fullPosts: PostDetail[] = draftsRaw.map((draft) => {
    const variants = allVariants
      .filter((v) => v.draftId === draft.id)
      .map((v) => ({ id: v.id, variantType: v.variantType, content: v.content }))

    const citations = allCitations
      .filter((c) => c.draftId === draft.id)
      .map((c) => ({
        id: c.id,
        claim: c.claim,
        quote: c.quote,
        sourceUrl: c.sourceUrl,
        sourceTitle: c.sourceTitle
      }))

    const media = allMedia.find((m) => m.draftId === draft.id) || null

    return {
      id: draft.id,
      accountId: draft.accountId,
      accountName: draft.accountName || 'Unknown Identity',
      accountHeadline: draft.accountHeadline,
      hook: draft.hook,
      body: draft.body,
      cta: draft.cta,
      firstComment: draft.firstComment,
      hashtags: (draft.hashtags as string[]) || [],
      charCount: draft.charCount,
      status: draft.status,
      createdAt: draft.createdAt,
      runId: draft.runId,
      variants,
      citations,
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
            regenerationAttempt: media.regenerationAttempt || 0
          }
        : null,
      lintFindings: (draft.lintFindings as any[]) || []
    }
  })

  return <PostsClient initialPosts={fullPosts} accounts={accounts} />
}
