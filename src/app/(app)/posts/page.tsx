import { db } from '@/db'
import {
  accountsTable,
  postDraftsTable,
  postVariantsTable,
  postCitationsTable,
  postMediaTable
} from '@/db/schema'
import { desc, eq, inArray } from 'drizzle-orm'
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
        accountHeadline: accountsTable.headline
      })
      .from(postDraftsTable)
      .leftJoin(accountsTable, eq(postDraftsTable.accountId, accountsTable.id))
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
    draftIds.length > 0
      ? db
          .select()
          .from(postMediaTable)
          .where(inArray(postMediaTable.draftId, draftIds))
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
      variants,
      citations,
      media: media
        ? {
            mode: media.mode,
            imageUrl: media.imageUrl,
            altText: media.altText,
            promptOrQuery: media.promptOrQuery
          }
        : null,
      lintFindings: (draft.lintFindings as any[]) || []
    }
  })

  return <PostsClient initialPosts={fullPosts} accounts={accounts} />
}
