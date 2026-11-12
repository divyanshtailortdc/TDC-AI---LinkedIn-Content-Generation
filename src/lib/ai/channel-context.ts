import type { Audience } from '@/db/schema'
import {
  DEFAULT_FORMAT,
  emojiOf,
  FORMATS,
  type ChannelNote,
  type FormatId,
  type PlatformId
} from '@/lib/formats'
import type { GenerationContext } from './context-blocks'

/**
 * The generation context as one format sees it. The identity, goals, voice
 * and evidence are the same everywhere; what changes per platform is which of
 * the author's own posts teach the rhythm, which earlier posts this one must
 * not repeat, and how freely it uses emoji. LinkedIn's view is the one it
 * always had.
 */

/** Below this many same-platform samples, every sample is shown instead. */
const MIN_PLATFORM_SAMPLES = 2

/** What the identity said about a platform; LinkedIn uses its profile and voice. */
export function channelNote(
  ctx: GenerationContext,
  platform: PlatformId
): ChannelNote | undefined {
  if (platform === 'linkedin') return undefined
  return ctx.prefs.channels.settings[platform]
}

export function forFormat(
  ctx: GenerationContext,
  formatId: FormatId
): GenerationContext {
  const platform = FORMATS[formatId].platform
  const samePlatform = ctx.samplePosts.filter(
    s => (s.platform || 'linkedin') === platform
  )
  const samplePosts =
    samePlatform.length >= MIN_PLATFORM_SAMPLES ? samePlatform : ctx.samplePosts

  if (formatId === DEFAULT_FORMAT) return { ...ctx, samplePosts }

  // The base context's emoji level is the voice's; each other platform has
  // its own (emojiOf). Applying it twice gives the same level.
  const emoji_level = emojiOf(
    ctx.prefs.channels?.settings ?? {},
    platform,
    ctx.prefs.constraints.emoji_level
  )

  return {
    ...ctx,
    prefs: {
      ...ctx.prefs,
      constraints: { ...ctx.prefs.constraints, emoji_level }
    },
    samplePosts,
    history: {
      ...ctx.history,
      drafts: (ctx.history.otherDrafts ?? [])
        .filter(d => d.formatId === formatId)
        .slice(0, 30)
    }
  }
}

/**
 * The people who follow the identity on one platform, as an audience row, so
 * ideation for that platform can offer them as a reader group. Null when the
 * identity has not described them.
 */
export function channelAudience(
  ctx: GenerationContext,
  platform: PlatformId
): Audience | null {
  const text = channelNote(ctx, platform)?.audience
  if (!text) return null
  return {
    id: `channel-${platform}`,
    accountId: ctx.account.id,
    name: text,
    jobTitles: [],
    seniority: [],
    industries: [],
    companySize: null,
    geography: null,
    painPoints: [],
    goals: [],
    desires: [],
    objections: [],
    sophisticationLevel: 'practitioner',
    whatTheyDontBelieveYet: null,
    createdAt: new Date(0),
    updatedAt: new Date(0)
  }
}
