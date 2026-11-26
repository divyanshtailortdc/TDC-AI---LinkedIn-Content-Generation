import {
  brandThemesTable,
  bufferConnectionsTable,
  goalsTable,
  ideasTable,
  knowledgeDocumentsTable,
  onboardingProgressTable,
  platformConnectionsTable,
  postDraftsTable,
  preferencesTable,
  publicationsTable,
  runsTable,
  voiceConfigsTable
} from '@/db/schema'
import { resolveChannels } from '@/lib/formats'
import { canPublish, type PublishingDb } from '@/lib/publishing/connection'
import {
  isBufferPlatform,
  type BufferPlatformId
} from '@/lib/publishing/platform'
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  min
} from 'drizzle-orm'
import type { ChannelFact, OnboardingFacts } from './progress'

/**
 * What is saved for the user and their active identity, for
 * onboardingProgress. Each step is read from the table it writes, so the
 * checklist is right however the work was done (the guide, the page itself,
 * the AI setup) and resumes on any device. Only existence and counts are
 * read: never a document's text or a token. No `server-only`, so the DB test
 * can pass its own connection.
 */
export async function loadOnboardingFacts(
  database: PublishingDb,
  input: {
    userId: string
    /** The active identity; null before the user has made one. */
    accountId: string | null
    /** Buffer can be connected on this server. */
    publishingAvailable: boolean
    /** The networks Buffer publishes on this server (enabledBufferPlatforms). */
    bufferPlatforms: readonly BufferPlatformId[]
  }
): Promise<OnboardingFacts & { completedAt: Date | null; hidden: boolean }> {
  const { userId, accountId } = input
  const [[buffer], [state]] = await Promise.all([
    database
      .select({ status: bufferConnectionsTable.status })
      .from(bufferConnectionsTable)
      .where(eq(bufferConnectionsTable.userId, userId))
      .limit(1),
    accountId
      ? database
          .select()
          .from(onboardingProgressTable)
          .where(eq(onboardingProgressTable.accountId, accountId))
          .limit(1)
      : []
  ])
  const bufferState: OnboardingFacts['buffer'] =
    buffer?.status === 'connected'
      ? 'connected'
      : buffer?.status === 'expired'
        ? 'expired'
        : 'none'

  if (!accountId) {
    return {
      ...EMPTY_IDENTITY,
      publishingAvailable: input.publishingAvailable,
      buffer: bufferState,
      completedAt: null,
      hidden: false
    }
  }
  // The first post is out and the guide put away: it shows nothing more for
  // this identity, so the step tables are not read on every page.
  if (state?.completedAt && state.hiddenAt) {
    return {
      ...EMPTY_IDENTITY,
      hasIdentity: true,
      publishingAvailable: input.publishingAvailable,
      buffer: bufferState,
      published: true,
      skipped: state.skipped,
      confirmed: state.confirmed,
      completedAt: state.completedAt,
      hidden: true
    }
  }

  const [
    [voice],
    [knowledge],
    [goals],
    [theme],
    [preference],
    connections,
    [run],
    ideaRows,
    postRows,
    [awaitingReview],
    [approved],
    [publication],
    [posted],
    [publishedOut]
  ] = await Promise.all([
    database
      .select({ id: voiceConfigsTable.id })
      .from(voiceConfigsTable)
      .where(eq(voiceConfigsTable.accountId, accountId))
      .limit(1),
    database
      .select({ n: count() })
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.accountId, accountId)),
    database
      .select({ n: count() })
      .from(goalsTable)
      .where(eq(goalsTable.accountId, accountId)),
    database
      .select({ id: brandThemesTable.id })
      .from(brandThemesTable)
      .where(eq(brandThemesTable.accountId, accountId))
      .limit(1),
    database
      .select({ enabledFormats: preferencesTable.enabledFormats })
      .from(preferencesTable)
      .where(eq(preferencesTable.accountId, accountId))
      .limit(1),
    database
      .select({
        platform: platformConnectionsTable.platform,
        status: platformConnectionsTable.status,
        name: platformConnectionsTable.name,
        scopes: platformConnectionsTable.scopes,
        bufferConnectionId: platformConnectionsTable.bufferConnectionId
      })
      .from(platformConnectionsTable)
      .where(eq(platformConnectionsTable.accountId, accountId)),
    database
      .select({
        id: runsTable.id,
        status: runsTable.status,
        error: runsTable.error
      })
      .from(runsTable)
      .where(eq(runsTable.accountId, accountId))
      .orderBy(desc(runsTable.createdAt))
      .limit(1),
    database
      .select({ status: ideasTable.status, n: count() })
      .from(ideasTable)
      .where(eq(ideasTable.accountId, accountId))
      .groupBy(ideasTable.status),
    database
      .select({ status: postDraftsTable.status, n: count() })
      .from(postDraftsTable)
      .where(eq(postDraftsTable.accountId, accountId))
      .groupBy(postDraftsTable.status),
    // The newest post still to review, and the newest approved one not out:
    // where the review and publish steps send the user. Hidden posts are out
    // of the Posts queue, so not offered here either.
    database
      .select({ id: postDraftsTable.id })
      .from(postDraftsTable)
      .where(
        and(
          eq(postDraftsTable.accountId, accountId),
          inArray(postDraftsTable.status, ['draft', 'awaiting_review']),
          isNull(postDraftsTable.hiddenAt)
        )
      )
      .orderBy(desc(postDraftsTable.createdAt))
      .limit(1),
    database
      .select({ id: postDraftsTable.id })
      .from(postDraftsTable)
      .where(
        and(
          eq(postDraftsTable.accountId, accountId),
          eq(postDraftsTable.status, 'approved'),
          isNull(postDraftsTable.postedAt),
          isNull(postDraftsTable.hiddenAt)
        )
      )
      .orderBy(
        desc(postDraftsTable.approvedAt),
        desc(postDraftsTable.createdAt)
      )
      .limit(1),
    database
      .select({
        draftId: publicationsTable.draftId,
        status: publicationsTable.status,
        scheduledAt: publicationsTable.scheduledAt,
        error: publicationsTable.error
      })
      .from(publicationsTable)
      .where(
        and(
          eq(publicationsTable.accountId, accountId),
          isNotNull(publicationsTable.draftId)
        )
      )
      .orderBy(desc(publicationsTable.createdAt))
      .limit(1),
    // Out on its platform once (even if deleted from it since), or marked
    // posted by hand: the first time either happened.
    database
      .select({ at: min(postDraftsTable.postedAt) })
      .from(postDraftsTable)
      .where(eq(postDraftsTable.accountId, accountId)),
    database
      .select({ at: min(publicationsTable.publishedAt) })
      .from(publicationsTable)
      .where(
        and(
          eq(publicationsTable.accountId, accountId),
          eq(publicationsTable.status, 'published')
        )
      )
  ])

  // The identity's platforms that publish through Buffer here, each with
  // the channel picked for it.
  const platforms = resolveChannels(preference).platforms.filter(
    (p): p is BufferPlatformId =>
      isBufferPlatform(p) && input.bufferPlatforms.includes(p)
  )
  const channels: ChannelFact[] = platforms.map(platform => {
    const connection = connections.find(c => c.platform === platform)
    return {
      platform,
      name: connection?.name ?? null,
      status: connection?.status ?? null,
      canPublish: Boolean(
        connection &&
        connection.status === 'connected' &&
        connection.bufferConnectionId &&
        canPublish(connection)
      )
    }
  })

  const firstPublishedAt =
    [posted?.at, publishedOut?.at]
      .filter((at): at is Date => at instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null

  const ideaCount = (status: string) =>
    ideaRows.find(r => r.status === status)?.n ?? 0
  const postCount = (status: string) =>
    postRows.find(r => r.status === status)?.n ?? 0

  return {
    hasIdentity: true,
    hasVoice: Boolean(voice),
    knowledgeDocs: knowledge?.n ?? 0,
    goals: goals?.n ?? 0,
    hasBrandTheme: Boolean(theme),
    publishingAvailable: input.publishingAvailable,
    buffer: bufferState,
    channels,
    latestRun: run ?? null,
    ideas: {
      total: ideaRows.reduce((sum, r) => sum + r.n, 0),
      proposed: ideaCount('proposed'),
      approved: ideaCount('approved'),
      drafting: ideaCount('drafting')
    },
    posts: {
      total: postRows.reduce((sum, r) => sum + r.n, 0),
      approved: postCount('approved'),
      awaitingReviewId: awaitingReview?.id ?? null,
      approvedId: approved?.id ?? null
    },
    publication: publication?.draftId
      ? {
          draftId: publication.draftId,
          status: publication.status,
          scheduledFor: publication.scheduledAt.toISOString(),
          error: publication.error
        }
      : null,
    published: firstPublishedAt !== null,
    firstPublishedAt: firstPublishedAt?.toISOString() ?? null,
    skipped: state?.skipped ?? [],
    confirmed: state?.confirmed ?? [],
    completedAt: state?.completedAt ?? null,
    hidden: Boolean(state?.hiddenAt)
  }
}

const EMPTY_IDENTITY: Omit<OnboardingFacts, 'publishingAvailable' | 'buffer'> =
  {
    hasIdentity: false,
    hasVoice: false,
    knowledgeDocs: 0,
    goals: 0,
    hasBrandTheme: false,
    channels: [],
    latestRun: null,
    ideas: { total: 0, proposed: 0, approved: 0, drafting: 0 },
    posts: { total: 0, approved: 0, awaitingReviewId: null, approvedId: null },
    publication: null,
    published: false,
    firstPublishedAt: null,
    skipped: [],
    confirmed: []
  }
