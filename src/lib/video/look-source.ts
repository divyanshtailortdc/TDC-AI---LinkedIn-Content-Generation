import 'server-only'

import { db } from '@/db'
import {
  accountsTable,
  platformInsightsTable,
  postDraftsTable,
  postVideosTable
} from '@/db/schema'
import type { PlatformId } from '@/lib/platforms'
import { insightsInUse } from '@/lib/profile-insights/in-use'
import type { InsightPost } from '@/lib/profile-insights/types'
import { and, desc, eq, sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { designVideoLook } from '~/lib/ai/skills/video-look'
import type { ResolvedBrandTheme } from '~/lib/brand/theme'
import { toDataUrl } from '~/lib/media/brand-logo'
import { loadLookExamples } from '~/lib/visual-examples/store'
import {
  DEFAULT_VIDEO_LOOK,
  lookInsightsSource,
  storedVideoLook,
  type VideoLook
} from './render/look'

/**
 * The format and look of an identity's next Reel or Short, matched to its
 * own recent posts: the analysis of its profile (src/lib/profile-insights),
 * the posts that analysis read, and a few of its post images
 * (src/lib/visual-examples), read by the video-look skill.
 *
 * Chosen once and reused: a look is stored with each video under a stamp of
 * what it was made from (the analysis, its posts, the images, the brand
 * colours), and a later video with the same stamp takes it from there
 * without a model call. A new analysis, new images or new brand colours make
 * a new one.
 *
 * Never fails a video: with nothing learned, or when the model cannot be
 * reached or a spending limit is met, it is the default look.
 */

/** Example images the skill sees, and the most shown behind slides. */
const LOOK_IMAGES = 6
/** Recent posts the skill reads. */
const LOOK_POSTS = 15

export interface VideoLookChoice {
  look: VideoLook
  /** The photos behind slides, in the look's order, as data URLs. */
  photos: Array<{
    dataUrl: string
    width: number | null
    height: number | null
  }>
  /** What the look was made from; null for the default look. */
  stamp: string | null
  /** Whose posts the look follows; null for the default look. */
  from: PlatformId | null
  /** Why the default look was used although something was learned. */
  warning: string | null
}

const DEFAULT_CHOICE: VideoLookChoice = {
  look: DEFAULT_VIDEO_LOOK,
  photos: [],
  stamp: null,
  from: null,
  warning: null
}

// Looks chosen in this process, by stamp: drafting starts a Reel, a Short and
// a Facebook Reel at once, and they share one.
const chosen = new Map<string, Promise<VideoLook>>()

const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex')

/** A look an earlier video of this identity stored under this stamp. */
async function storedLook(
  accountId: string,
  stamp: string
): Promise<VideoLook | null> {
  const [row] = await db
    .select({ metadata: postVideosTable.metadata })
    .from(postVideosTable)
    .innerJoin(postDraftsTable, eq(postDraftsTable.id, postVideosTable.draftId))
    .where(
      and(
        eq(postDraftsTable.accountId, accountId),
        sql`${postVideosTable.metadata}->>'lookStamp' = ${stamp}`
      )
    )
    .orderBy(desc(postVideosTable.createdAt))
    .limit(1)
  return storedVideoLook(row?.metadata?.look)
}

/** A stored analysis's posts as the skill reads them: those with something to say. */
function recentPosts(value: unknown): InsightPost[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (p): p is InsightPost =>
        Boolean(p) &&
        typeof p === 'object' &&
        typeof p.text === 'string' &&
        typeof p.kind === 'string'
    )
    .filter(p => p.text.trim() || p.aspect)
    .slice(0, LOOK_POSTS)
}

export async function videoLookFor(options: {
  accountId: string
  /** Where the video goes. */
  platform: PlatformId
  brand: ResolvedBrandTheme
}): Promise<VideoLookChoice> {
  const { accountId, platform, brand } = options
  const [account] = await db
    .select({
      name: accountsTable.name,
      company: accountsTable.company,
      websiteUrl: accountsTable.websiteUrl,
      contextIdentity: accountsTable.contextIdentity
    })
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId))
    .limit(1)
  if (!account) return DEFAULT_CHOICE

  const rows = await db
    .select({
      platform: platformInsightsTable.platform,
      profileUrl: platformInsightsTable.profileUrl,
      insights: platformInsightsTable.insights,
      posts: platformInsightsTable.posts
    })
    .from(platformInsightsTable)
    .where(eq(platformInsightsTable.accountId, accountId))
  const source = lookInsightsSource(insightsInUse(rows, account), platform)
  // The posts that analysis read: what they post there, and how it opens
  const posts = recentPosts(
    rows.find(r => r.platform === source?.platform)?.posts
  )
  const examples = (
    await loadLookExamples(accountId, platform).catch(err => {
      console.warn('Example posts could not be loaded for a video:', err)
      return []
    })
  ).slice(0, LOOK_IMAGES)
  if (!source && examples.length === 0) return DEFAULT_CHOICE

  const colours = {
    primaryColor: brand.primaryColor,
    accentColor: brand.accentColor,
    backgroundColor: brand.backgroundColor
  }
  const stamp = hash(
    JSON.stringify({
      v: 2,
      platform,
      from: source?.platform ?? null,
      insights: source?.insights ?? null,
      posts,
      images: examples.map(e => hash(e.data)),
      colours
    })
  ).slice(0, 32)

  let pending = chosen.get(stamp)
  if (!pending) {
    pending = (async () => {
      const stored = await storedLook(accountId, stamp)
      if (stored) return stored
      const { look } = await designVideoLook({
        platform,
        insightsPlatform: source?.platform ?? null,
        insights: source?.insights ?? null,
        posts,
        brand: colours,
        images: examples.map(e => ({
          data: e.data,
          mediaType: e.mediaType,
          width: e.width,
          height: e.height,
          platform: e.platform
        }))
      })
      return look
    })()
    chosen.set(stamp, pending)
    // A failed choice is tried again by the next video, not remembered.
    pending.catch(() => chosen.delete(stamp))
  }

  let look: VideoLook
  try {
    look = await pending
  } catch (err) {
    console.warn('The video look could not be chosen:', err)
    const why = err instanceof Error && err.message ? `: ${err.message}` : ''
    return {
      ...DEFAULT_CHOICE,
      warning: `The look of your posts could not be matched${why}. The brand look was used.`
    }
  }
  return {
    look,
    photos: look.photos.flatMap(i => {
      const e = examples[i]
      return e
        ? [
            {
              dataUrl: toDataUrl(e.data, e.mediaType),
              width: e.width,
              height: e.height
            }
          ]
        : []
    }),
    stamp,
    from: source?.platform ?? examples[0]?.platform ?? null,
    warning: null
  }
}
