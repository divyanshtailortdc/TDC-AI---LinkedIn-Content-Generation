import { PLATFORM_IDS, PLATFORMS, type PlatformId } from '@/lib/platforms'
import { scriptInsightsSource } from '@/lib/video/render/look'
import type { ProfileInsights } from './types'

/**
 * What prompts are told about how an identity already posts on a platform,
 * from its profile's analysis. Each block is empty when nothing was learned,
 * so a prompt for an identity without one reads exactly as before (the
 * LinkedIn golden tests hold every byte of it).
 *
 * Only the analysis goes into prompts, never the posts it was made from: new
 * posts should sound like the account, not echo what it already said.
 */

export type PlatformInsights = Partial<Record<PlatformId, ProfileInsights>>

const ORIGINALITY =
  'never copy, continue or closely rephrase one of their posts, and never reuse their exact lines or jokes'

/** For writing a post on `platform`: how the author's posts there read. */
export function renderInsightsForDrafting(
  insights: ProfileInsights | null | undefined,
  platform: PlatformId
): string {
  if (!insights) return ''
  const label = PLATFORMS[platform].name
  const tags =
    insights.hashtags.length > 0
      ? `Their own: ${insights.hashtags.slice(0, 12).join(' ')}; prefer these to new ones where they fit.`
      : ''
  const lines = [
    `WHAT THEIR ${label.toUpperCase()} ALREADY LOOKS LIKE — learned from their own public ${label} posts. Write this post so it belongs among them, in their style, but as a new post: ${ORIGINALITY}. Where anything above says otherwise, follow that.`,
    insights.themes.length > 0 &&
      `- What they post about: ${insights.themes.map(t => t.name).join('; ')}`,
    insights.writingStyle && `- How they write: ${insights.writingStyle}`,
    insights.tone && `- Tone: ${insights.tone}`,
    insights.captions && `- Captions: ${insights.captions}`,
    // The format's hashtag rule is checked on every draft, so it decides how many.
    (insights.hashtagUsage || tags) &&
      `- Hashtags, within the hashtag rule you are given: ${[insights.hashtagUsage, tags].filter(Boolean).join(' ')}`
  ]
  return lines.filter(Boolean).join('\n')
}

/**
 * What each of `platforms` showed, one paragraph per platform that was
 * analyzed, for prompts that plan: subjects, kinds of post, tone. Empty
 * when none was.
 */
function describePlatforms(
  all: PlatformInsights | undefined,
  platforms: readonly PlatformId[]
): string {
  const shown = platforms.filter(p => all?.[p])
  return shown
    .map(p => {
      const i = all![p]!
      return [
        `${PLATFORMS[p].name}:`,
        i.summary && `- In short: ${i.summary}`,
        i.themes.length > 0 &&
          `- Subjects it keeps coming back to: ${i.themes
            .map(t => (t.description ? `${t.name} (${t.description})` : t.name))
            .join('; ')}`,
        i.formats.length > 0 &&
          `- Kinds of post it makes: ${i.formats
            .map(f => (f.note ? `${f.format} (${f.note})` : f.format))
            .join('; ')}`,
        i.tone && `- Tone: ${i.tone}`
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}

/**
 * For planning ideas on `platforms`: what the account already posts about,
 * as background. Starts and ends with a blank line, to sit between the
 * ideation prompt's blocks.
 */
export function renderInsightsForIdeation(
  all: PlatformInsights | undefined,
  platforms: readonly PlatformId[]
): string {
  const blocks = describePlatforms(all, platforms)
  if (!blocks) return ''
  return `
WHAT THIS ACCOUNT ALREADY POSTS — learned from its own public posts
${blocks}
Keep every idea recognisably this account's: its world, its tone, the kinds of post it makes. But these show its range, not a list to repeat: bring subjects and angles it has not already covered, and an idea need not be about any of them. Never rework one of its existing posts.
`
}

/**
 * For suggesting goals: what the account already posts on the platforms it
 * posts on, as part of its profile. Empty when none was analyzed.
 */
export function renderInsightsForGoals(
  all: PlatformInsights | undefined,
  platforms: readonly PlatformId[]
): string {
  const blocks = describePlatforms(all, platforms)
  return blocks
    ? `WHAT IT ALREADY POSTS — learned from its own public posts\n${blocks}`
    : ''
}

/** Longest learned subject searched, in words: a theme name, not its description. */
const SUBJECT_WORDS = 6

/**
 * The subjects the account posts most about on `platforms`, for research:
 * each platform's first theme, then each one's second, and so on, repeats
 * (in any case) left out, at most `limit`.
 */
export function learnedSubjects(
  all: PlatformInsights | undefined,
  platforms: readonly PlatformId[],
  limit: number
): string[] {
  const lists = platforms.map(p => all?.[p]?.themes ?? [])
  const out: string[] = []
  const seen = new Set<string>()
  const longest = Math.max(0, ...lists.map(l => l.length))
  for (let i = 0; i < longest && out.length < limit; i++) {
    for (const list of lists) {
      const name = list[i]?.name.split(/\s+/).slice(0, SUBJECT_WORDS).join(' ').trim()
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      out.push(name)
      if (out.length >= limit) break
    }
  }
  return out
}

/**
 * For the research agent: the subjects the account already posts about, on
 * every platform analyzed, as one line. Empty when none was.
 */
export function renderInsightsForResearch(all: PlatformInsights | undefined): string {
  const seen = new Set<string>()
  const subjects = PLATFORM_IDS.flatMap(p => all?.[p]?.themes ?? []).filter(t => {
    const key = t.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (subjects.length === 0) return ''
  return `Subjects it already posts about, learned from its own public posts (look for where a goal meets one of these; never research one for its own sake): ${subjects
    .map(t => (t.description ? `${t.name} (${t.description})` : t.name))
    .join('; ')}`
}

/**
 * For writing a Reel's or Short's script: how the author's posts read and
 * look, from the video's own platform or, where that was not studied, their
 * nearest short-video account (YouTube is never analyzed, so a Short reads
 * their Instagram, else their Facebook). The video is made in that look
 * (src/lib/video/look-source.ts), so its on-screen words should be set the
 * way their posts set words. Empty when nothing was learned.
 */
export function renderInsightsForVideo(
  all: PlatformInsights | undefined,
  platform: PlatformId
): string {
  const source = scriptInsightsSource(all, platform)
  if (!source) return ''
  const { insights } = source
  const extra = [
    source.platform !== platform &&
      `- These are their ${PLATFORMS[source.platform].name} posts: their ${PLATFORMS[platform].name} was not studied, and this is their nearest account of short videos.`,
    insights.formats.length > 0 &&
      `- What they post there: ${insights.formats.map(f => `${f.format} (${f.note})`).join('; ')}`,
    insights.visualIdentity &&
      `- How their posts look: ${insights.visualIdentity} This video is made in that look: write each shot's on-screen text the way their posts put words on images (how many words, capitals, numbers).`
  ].filter(Boolean)
  return [renderInsightsForDrafting(insights, source.platform), ...extra].join(
    '\n'
  )
}

/**
 * For designing a carousel's slides on `platform`: how the author's posts
 * there read and look. Empty when nothing was learned there.
 */
export function renderInsightsForSlides(
  insights: ProfileInsights | null | undefined,
  platform: PlatformId,
  /** The slides are made like these posts (Like my posts), not drawn in the brand. */
  likeTheirPosts = false
): string {
  if (!insights) return ''
  const label = PLATFORMS[platform].name
  const lines = [
    insights.tone && `- Tone: ${insights.tone}`,
    insights.writingStyle && `- How they write: ${insights.writingStyle}`,
    insights.visualIdentity &&
      `- How their posts look: ${insights.visualIdentity} ${
        likeTheirPosts
          ? '(every slide is made in this look)'
          : "(for the pictures; the slides' colours and fonts are the brand's)"
      }`
  ].filter(Boolean)
  if (lines.length === 0) return ''
  return [
    `WHAT THEIR ${label.toUpperCase()} POSTS ALREADY LOOK LIKE — learned from their own public ${label} posts. Write and picture these slides so they belong among them, as new ones: ${ORIGINALITY}. Where anything above says otherwise, follow that.`,
    ...lines
  ].join('\n')
}

/** How the account's posts on `platform` look, for the image brief; empty when unseen. */
export function visualIdentityFor(
  all: PlatformInsights | undefined,
  platform: PlatformId
): string {
  return all?.[platform]?.visualIdentity?.trim() ?? ''
}
