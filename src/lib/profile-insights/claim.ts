import { platformInsightsTable } from '@/db/schema'
import { PLATFORM_IDS, type PlatformId } from '@/lib/formats'
import { canonicalProfileLink, type ProfileLinks } from '@/lib/profile-links'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import {
  ANALYSIS_STALE_MS,
  isAnalyzablePlatform,
  type InsightPost,
  type InsightSources,
  type InsightStatus,
  type ProfileInsights
} from './types'

/**
 * The platform_insights row's life: claimed when an analysis starts, written
 * once when it ends. Over a database passed in, so tests run it against the
 * local one (tests/profile-insights-db.test.ts).
 */

export type InsightsDb = PgDatabase<PostgresJsQueryResultHKT, any, any>

export type AnalysisClaim = {
  accountId: string
  platform: PlatformId
  profileUrl: string
  startedAt: Date
}

/** The address a link is analyzed and compared under: two spellings of one profile are one. */
export function analyzedLink(platform: PlatformId, link: string): string {
  return canonicalProfileLink(platform, link) ?? link.trim()
}

/**
 * What a save of the profile links changes for their analyses: the
 * platforms whose link was removed, and those whose link is new or names
 * another profile. Pure.
 */
export function linkChanges(
  saved: ProfileLinks,
  next: ProfileLinks
): { removed: PlatformId[]; changed: PlatformId[] } {
  return {
    removed: PLATFORM_IDS.filter(p => saved[p] && !next[p]),
    changed: PLATFORM_IDS.filter(
      p =>
        Boolean(next[p]) &&
        isAnalyzablePlatform(p) &&
        (!saved[p] || analyzedLink(p, saved[p]!) !== analyzedLink(p, next[p]!))
    )
  }
}

/**
 * Marks a platform's profile as being analyzed and returns the claim to run
 * it with, or null when an analysis of the same link is already running
 * (one cut off long ago does not count). A new link starts over: what was
 * learned about the old profile is dropped.
 */
export async function claimProfileAnalysis(
  database: InsightsDb,
  accountId: string,
  platform: PlatformId,
  link: string,
  now = new Date()
): Promise<AnalysisClaim | null> {
  const t = platformInsightsTable
  const profileUrl = analyzedLink(platform, link)
  const stale = new Date(now.getTime() - ANALYSIS_STALE_MS)
  const sameLink = sql`${t.profileUrl} = excluded.profile_url`
  const keep = (column: AnyInsightColumn, fresh: string) =>
    sql`case when ${sameLink} then ${column} else ${sql.raw(fresh)} end`
  const [row] = await database
    .insert(t)
    .values({
      accountId,
      platform,
      profileUrl,
      status: 'analyzing',
      startedAt: now
    })
    .onConflictDoUpdate({
      target: [t.accountId, t.platform],
      set: {
        profileUrl: sql`excluded.profile_url`,
        status: 'analyzing',
        error: null,
        startedAt: now,
        updatedAt: now,
        insights: keep(t.insights, 'null'),
        posts: keep(t.posts, `'[]'::jsonb`),
        sources: keep(t.sources, `'{}'::jsonb`),
        analyzedAt: keep(t.analyzedAt, 'null'),
        editedAt: keep(t.editedAt, 'null')
      },
      // (A Date inside sql`` is not serialized by the driver, so it goes as text.)
      setWhere: sql`${t.status} <> 'analyzing' or ${t.startedAt} is null or ${t.startedAt} < ${stale.toISOString()}::timestamptz or not (${sameLink})`
    })
    .returning({ startedAt: t.startedAt })
  return row?.startedAt
    ? { accountId, platform, profileUrl, startedAt: row.startedAt }
    : null
}

type AnyInsightColumn =
  | typeof platformInsightsTable.insights
  | typeof platformInsightsTable.posts
  | typeof platformInsightsTable.sources
  | typeof platformInsightsTable.analyzedAt
  | typeof platformInsightsTable.editedAt

/** Drops the analyses of the given platforms' profiles. */
export async function dropProfileAnalyses(
  database: InsightsDb,
  accountId: string,
  platforms: PlatformId[]
) {
  if (platforms.length === 0) return
  const t = platformInsightsTable
  await database
    .delete(t)
    .where(and(eq(t.accountId, accountId), inArray(t.platform, platforms)))
}

/**
 * Records how a claimed analysis ended, only while it is still the row's
 * latest analysis of the same link: a newer one (a refresh, a changed link)
 * is never overwritten by an older one finishing late. Returns whether it
 * was recorded.
 */
export async function finishProfileAnalysis(
  database: InsightsDb,
  claim: AnalysisClaim,
  values: {
    status: InsightStatus
    error: string | null
    insights?: ProfileInsights
    posts?: InsightPost[]
    sources?: InsightSources
    analyzedAt?: Date
    editedAt?: null
  }
): Promise<boolean> {
  const t = platformInsightsTable
  const updated = await database
    .update(t)
    .set({ ...values, updatedAt: new Date() })
    .where(
      and(
        eq(t.accountId, claim.accountId),
        eq(t.platform, claim.platform),
        eq(t.profileUrl, claim.profileUrl),
        eq(t.startedAt, claim.startedAt)
      )
    )
    .returning({ id: t.id })
  return updated.length > 0
}
