import { PLATFORMS, type PlatformId } from '@/lib/platforms'
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
 * For planning ideas on `platforms`: what the account already posts about,
 * as background. Starts and ends with a blank line, to sit between the
 * ideation prompt's blocks.
 */
export function renderInsightsForIdeation(
  all: PlatformInsights | undefined,
  platforms: readonly PlatformId[]
): string {
  const shown = platforms.filter(p => all?.[p])
  if (shown.length === 0) return ''
  const blocks = shown.map(p => {
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
  return `
WHAT THIS ACCOUNT ALREADY POSTS — learned from its own public posts
${blocks.join('\n\n')}
Keep every idea recognisably this account's: its world, its tone, the kinds of post it makes. But these show its range, not a list to repeat: bring subjects and angles it has not already covered, and an idea need not be about any of them. Never rework one of its existing posts.
`
}

/** How the account's posts on `platform` look, for the image brief; empty when unseen. */
export function visualIdentityFor(
  all: PlatformInsights | undefined,
  platform: PlatformId
): string {
  return all?.[platform]?.visualIdentity?.trim() ?? ''
}
