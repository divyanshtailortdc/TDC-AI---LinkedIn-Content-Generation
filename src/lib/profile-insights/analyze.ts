import 'server-only'

import { db } from '@/db'
import { accountsTable, platformInsightsTable } from '@/db/schema'
import { SkillError } from '@/lib/ai/run-skill'
import { analyzeProfilePosts } from '@/lib/ai/skills/profile-analysis'
import { withAiSpend } from '@/lib/ai/spend'
import { PLATFORMS, type PlatformId } from '@/lib/formats'
import { profileLinksOf, type ProfileLinks } from '@/lib/profile-links'
import { isBufferPlatform } from '@/lib/publishing/platform'
import { eq } from 'drizzle-orm'
import {
  claimProfileAnalysis,
  dropProfileAnalyses,
  finishProfileAnalysis,
  linkChanges,
  type AnalysisClaim
} from './claim'
import { collectProfilePosts, type CollectedPosts } from './collect'
import {
  profileRefOf,
  UnanalyzableLinkError,
  type ProfileRef
} from './public-posts'
import {
  cleanProfileInsights,
  effectiveStatus,
  INTERRUPTED_MESSAGE,
  isAnalyzablePlatform,
  type ProfileInsightView
} from './types'

export type { AnalysisClaim }

/**
 * Analyzing an identity's public profile on a platform: claimed while the
 * request that asked for it is answered, then run after the response
 * (`after`), with the row reading 'analyzing' meanwhile so the Profile page
 * can follow it. A minute or two, mostly the model.
 */

/** Fewer readable posts than this teach a habit, not a style. */
const MIN_POSTS = 3
/** Shorter than this, a post's text says nothing about how it is written. */
const MIN_TEXT = 12
/** The whole analysis, searches included, gives up after this. */
const RUN_TIMEOUT_MS = 4 * 60_000

/**
 * Applies a profile's link changes to its analyses: a link removed drops its
 * analysis, and a new or changed one is claimed for analysis. Returns the
 * claims, to run once the response is sent.
 */
export async function syncProfileAnalyses(
  accountId: string,
  saved: ProfileLinks,
  next: ProfileLinks
): Promise<AnalysisClaim[]> {
  const { removed, changed } = linkChanges(saved, next)
  await dropProfileAnalyses(db, accountId, removed)
  const claims = await Promise.all(
    changed.map(p => claimProfileAnalysis(db, accountId, p, next[p]!))
  )
  return claims.filter((c): c is AnalysisClaim => c !== null)
}

/** Why an analysis could not be made, for the user, with what they can do instead. */
function unavailableMessage(
  ref: ProfileRef,
  collected: CollectedPosts,
  readable: number
): string {
  const label = PLATFORMS[ref.platform].label
  // LinkedIn's own posts are pasted on the Voice page; every other platform's in Preferences.
  const paste =
    ref.platform === 'linkedin'
      ? ' You can paste a few of your posts on the Voice page instead'
      : ` You can paste a few of your ${label} posts in Preferences instead`
  const instead = `${paste}${
    isBufferPlatform(ref.platform) && !collected.bufferConnected
      ? `, or connect ${label} in Settings → Integrations so the posts you send through Buffer can be read`
      : ''
  }.`
  if (!collected.searchConfigured && !collected.bufferConnected) {
    return `Public posts cannot be looked up: web search is not set up on this server.${instead}`
  }
  const who = `@${ref.handle}`
  const found =
    readable === 0
      ? `No public ${label} posts by ${who} could be found.`
      : `Only ${readable} public ${label} post${readable === 1 ? '' : 's'} by ${who} could be found, too few to learn from.`
  return `${found} The account may be private or new, or search engines may not show its posts yet.${instead}`
}

function failureMessage(err: unknown): string {
  if (err instanceof UnanalyzableLinkError) return err.message
  if (err instanceof SkillError) {
    if (err.reason === 'not_configured')
      return 'AI is not set up on this server, so posts cannot be analyzed.'
    if (err.reason === 'quota_exceeded')
      return 'The AI budget is used up for now. Try again later.'
    if (err.reason === 'spend_limit') return err.message
    if (err.reason === 'timeout')
      return 'The analysis took too long. Try again.'
    if (err.transient)
      return 'The AI could not be reached. Try again in a minute.'
  }
  if (err instanceof Error && err.name === 'TimeoutError')
    return 'The analysis took too long. Try again.'
  return 'The analysis failed. Try again.'
}

/**
 * Runs a claimed analysis and saves how it went. Never throws. It writes
 * only while it is still the row's latest analysis of the same link, so a
 * newer one (a refresh, a changed link) is never overwritten by an older
 * one finishing late. A failed or empty refresh keeps the insights from
 * before; only the status says what happened.
 */
export async function runProfileAnalysis(claim: AnalysisClaim): Promise<void> {
  const { accountId, platform, profileUrl } = claim
  const finish = (values: Parameters<typeof finishProfileAnalysis>[2]) =>
    finishProfileAnalysis(db, claim, values)

  try {
    const account = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, accountId)
    })
    if (!account) return
    const ref = profileRefOf(platform, profileUrl, account.name)
    const signal = AbortSignal.timeout(RUN_TIMEOUT_MS)
    const collected = await collectProfilePosts({ accountId, ref, signal })
    const readable = collected.posts.filter(
      p => p.text.trim().length >= MIN_TEXT
    )
    if (readable.length < MIN_POSTS) {
      await finish({
        status: 'unavailable',
        error: unavailableMessage(ref, collected, readable.length)
      })
      return
    }
    // Charged to the identity's owner, after the response that started it.
    const { insights } = await withAiSpend(
      { source: 'identity', accountId },
      () =>
        analyzeProfilePosts({
          platform,
          account: {
            name: account.name,
            accountType: account.accountType,
            industry: account.industry,
            bio: account.bio
          },
          profile: {
            url: ref.url,
            handle: ref.handle,
            ...(collected.displayName
              ? { displayName: collected.displayName }
              : {}),
            ...(collected.bio ? { bio: collected.bio } : {})
          },
          posts: collected.posts,
          images: collected.images.map(({ data, mediaType }) => ({
            data,
            mediaType
          })),
          imagePosts: collected.images.map(i => i.postUrl),
          abortSignal: signal
        })
    )
    await finish({
      status: 'ready',
      error: null,
      insights,
      posts: collected.posts,
      sources: collected.sources,
      analyzedAt: new Date(),
      editedAt: null
    })
  } catch (err) {
    if (!(err instanceof UnanalyzableLinkError)) {
      console.error(
        `Analyzing the ${platform} profile of ${accountId} failed:`,
        err
      )
    }
    await finish({
      status: err instanceof UnanalyzableLinkError ? 'unavailable' : 'failed',
      error: failureMessage(err)
    }).catch(writeErr =>
      console.error('Could not record the failed analysis:', writeErr)
    )
  }
}

/**
 * Starts a fresh analysis of the identity's saved link on `platform`, for
 * Refresh. Null with a reason when there is no link to analyze, or one is
 * already being analyzed.
 */
export async function startProfileAnalysis(
  accountId: string,
  platform: PlatformId
): Promise<{ claim: AnalysisClaim } | { error: string }> {
  if (!isAnalyzablePlatform(platform)) {
    return { error: `${PLATFORMS[platform].label} profiles are not analyzed.` }
  }
  const account = await db.query.accountsTable.findFirst({
    columns: { profileLinks: true, linkedinUrl: true },
    where: eq(accountsTable.id, accountId)
  })
  const link = account ? profileLinksOf(account)[platform] : undefined
  if (!link) {
    return {
      error: `Add your ${PLATFORMS[platform].label} profile link first.`
    }
  }
  const claim = await claimProfileAnalysis(db, accountId, platform, link)
  return claim
    ? { claim }
    : { error: 'This profile is already being analyzed.' }
}

/** Every platform analysis of an identity, for its Profile page. */
export async function profileInsightViews(
  accountId: string
): Promise<ProfileInsightView[]> {
  const t = platformInsightsTable
  const rows = await db.select().from(t).where(eq(t.accountId, accountId))
  return rows.map(row => {
    const status = effectiveStatus(row)
    const interrupted = row.status === 'analyzing' && status === 'failed'
    return {
      platform: row.platform,
      profileUrl: row.profileUrl,
      status,
      error: interrupted ? INTERRUPTED_MESSAGE : row.error,
      insights: cleanProfileInsights(row.insights),
      posts: Array.isArray(row.posts) ? row.posts : [],
      sources: row.sources ?? {},
      analyzedAt: row.analyzedAt?.toISOString() ?? null,
      editedAt: row.editedAt?.toISOString() ?? null
    }
  })
}
