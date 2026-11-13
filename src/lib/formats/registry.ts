import { PLATFORMS as POST_PLATFORMS, isPlatformId } from '@/lib/platforms'
import {
  DEFAULT_FORMAT,
  FORMAT_IDS,
  PLATFORM_IDS,
  type FormatId,
  type FormatSpec,
  type PlatformId,
  type PlatformInfo
} from './types'

/**
 * One entry per platform and per format. LinkedIn's entry describes what the
 * existing LinkedIn pipeline already does (src/lib/ai/skills/post-drafting,
 * with its limits from src/lib/platforms); that pipeline keeps its own prompt,
 * so the entry's rules are not sent anywhere yet.
 */

export const PLATFORMS: Record<PlatformId, PlatformInfo> = {
  linkedin: {
    id: 'linkedin',
    label: POST_PLATFORMS.linkedin.name,
    ideationProfile:
      'Professional peers, buyers and future hires. Works: lessons from real work, decisions and trade-offs, frameworks, analysis of what a development means for the reader, contrarian takes backed by evidence. Falls flat: hard selling, memes, generic motivation.',
    register:
      'Professional and conversational: one idea made through one concrete example, written for peers.',
    opening:
      'A specific moment, a figure from the evidence, or a claim a peer could disagree with, complete before the fold.'
  },
  x: {
    id: 'x',
    label: POST_PLATFORMS.x.name,
    ideationProfile:
      'Fast, opinionated and news-aware. Works: sharp takes, reactions to what is happening in the field this week, short threads that break down a process or a misconception, one specific number. Falls flat: long build-ups, corporate announcements, anything that needs a picture to make sense.',
    register:
      'Sharp and compressed. One claim or observation, stated plainly, with no preamble and no sign-off. Reads like something said out loud to a peer.',
    opening: 'The claim itself, in as few words as it takes. No scene-setting.'
  },
  threads: {
    id: 'threads',
    label: POST_PLATFORMS.threads.name,
    ideationProfile:
      'Casual conversation. Works: honest opinions, open questions, behind-the-scenes thoughts, light takes that invite replies. Falls flat: polished announcements, long analysis, posts that only point to a link.',
    register:
      'Conversational and informal, closer to talking than publishing. An opinion or a question starts a conversation; corporate polish falls flat.',
    opening:
      'The way the author would start talking: an opinion or an honest question, not a headline.'
  },
  facebook: {
    id: 'facebook',
    label: POST_PLATFORMS.facebook.name,
    ideationProfile:
      'A community of customers and followers who already know the brand, often local. Works: stories about people and customers, behind the scenes, events, practical tips, questions people can answer from their own experience. Falls flat: jargon, insider industry debate, thought-leadership essays.',
    register:
      'Warm and conversational, written for people who chose to follow the brand. Plain words, a personal angle, and a question people can answer from their own experience.',
    opening:
      'Something followers recognise from their own life or work: a moment, a person, a familiar problem.'
  },
  instagram: {
    id: 'instagram',
    label: POST_PLATFORMS.instagram.name,
    ideationProfile:
      'Visual first. Works: ideas that can be shown: tips as a carousel, before and after, behind the scenes, team and culture, a product in use, one striking figure or quote as an image. Falls flat: abstract arguments with nothing to show, long analysis, posts that depend on a link.',
    register:
      'Visual first and personal. The caption supports an image: the first line hooks, the rest tells the story behind the visual. Lighter and warmer than LinkedIn, with short paragraphs.',
    opening:
      'A short line that makes the image make sense, or makes someone stop scrolling to read it. Not a headline.'
  },
  youtube: {
    id: 'youtube',
    label: POST_PLATFORMS.youtube.name,
    ideationProfile:
      'Searchable and evergreen. Works for Shorts: one clear how-to, one answer to a question people search, one misconception explained. Falls flat: news that dates in a week, inside jokes, ideas that only work with long context.',
    register:
      'Clear and helpful, a knowledgeable person explaining to camera. Plain spoken words; the title says exactly what the viewer gets.',
    opening:
      'A spoken first line that promises the one thing the viewer will know by the end, then delivers it.'
  }
}

const X_LINK_NOTE =
  'Posts with links usually reach fewer people on X. Leave links out of the post unless the goal needs one, and then put it in the reply, which is published under the post.'

export const FORMATS: Record<FormatId, FormatSpec> = {
  'linkedin.post': {
    id: 'linkedin.post',
    // A carousel goes out as a document: LinkedIn shows a PDF page by page.
    media: {
      formats: ['image', 'text', 'carousel'],
      carousel: {
        minSlides: 2,
        maxSlides: 20,
        targetSlides: { min: 6, max: 9 },
        delivery: 'document'
      }
    },
    imageShape: '1.91:1',
    platform: 'linkedin',
    label: 'LinkedIn post',
    version: 1,
    structure: 'single',
    // LinkedIn's own limits, as its pipeline uses them.
    limits: {
      count: 'utf16',
      maxChars: POST_PLATFORMS.linkedin.limits.maxChars,
      targetChars: POST_PLATFORMS.linkedin.limits.targetChars,
      foldChars: POST_PLATFORMS.linkedin.limits.hookMaxChars
    },
    hashtags: 'voice',
    links: { inBody: 'reach_penalty', fallback: 'first_comment' },
    rules: [],
    commentLabel: 'First comment'
  },
  'x.post': {
    id: 'x.post',
    media: { formats: ['text', 'image'], maxImages: 4 },
    imageShape: '16:9',
    platform: 'x',
    label: 'X post',
    // 2: links go in the reply, which is published; one emoji at most.
    version: 2,
    structure: 'single',
    limits: { count: 'x_weighted', maxChars: 280, targetChars: 220, foldChars: null },
    hashtags: { min: 0, max: 1 },
    links: { inBody: 'reach_penalty', fallback: 'reply', note: X_LINK_NOTE },
    rules: [
      'The whole post (hook, body, call to action and hashtags together) must fit in 280 characters as X counts them: every link counts as 23, and emoji count as 2.',
      'One or two sentences is normal. Leave the body empty when the hook says it all.',
      'A call to action, when the post has one (required or not), is one short question in the same post.',
      'Plain text: no markdown, no bullet lists, no thread numbering.'
    ],
    commentLabel: 'Reply'
  },
  'x.thread': {
    id: 'x.thread',
    media: { formats: ['text', 'image'], maxImages: 4 },
    imageShape: '16:9',
    platform: 'x',
    label: 'X thread',
    // 2: links go in the reply, which is published; one emoji at most;
    // the posts follow the core argument as one connected flow.
    version: 2,
    structure: 'thread',
    limits: {
      count: 'x_weighted',
      maxChars: 280,
      targetChars: 230,
      foldChars: null,
      parts: { min: 3, max: 7 }
    },
    hashtags: { min: 0, max: 1 },
    links: { inBody: 'reach_penalty', fallback: 'reply', note: X_LINK_NOTE },
    rules: [
      'Write 3 to 7 posts. Each must fit in 280 characters as X counts them (every link counts as 23, emoji as 2) and make sense on its own.',
      'Plan the thread from the core argument before writing it: one step of the argument per post, in the order the argument runs.',
      'The first post is the hook: it makes the claim and earns the read on its own.',
      'Each following post adds one step: a reason, an example or a piece of evidence. It picks up where the previous post stopped and leads into the next, so the posts read as one connected argument. No filler posts, and nothing said twice.',
      'A figure or quote goes in the post that makes the claim it supports.',
      'The last post lands the takeaway and, when the goal calls for one, the ask.',
      'Do not number the posts ("1/", "2/7"); the platform shows the thread.',
      'Plain text: no markdown and no bullet lists.'
    ],
    commentLabel: 'Reply'
  },
  'threads.post': {
    id: 'threads.post',
    media: { formats: ['text', 'image'] },
    imageShape: '4:5',
    platform: 'threads',
    label: 'Threads post',
    version: 1,
    structure: 'single',
    limits: { count: 'utf16', maxChars: 500, targetChars: 320, foldChars: null },
    hashtags: { min: 0, max: 1 },
    links: { inBody: 'ok', fallback: 'reply' },
    rules: [
      'The whole post must fit in 500 characters.',
      'Write it the way the author would say it in conversation. End on an opinion or a question people want to answer.',
      'At most one topic tag.',
      'Plain text: no markdown.'
    ],
    commentLabel: 'Reply'
  },
  'facebook.post': {
    id: 'facebook.post',
    // Several photos in one post, which Facebook shows as a grid.
    media: {
      formats: ['text', 'image', 'carousel'],
      carousel: {
        minSlides: 2,
        maxSlides: 10,
        targetSlides: { min: 4, max: 6 },
        delivery: 'images'
      }
    },
    imageShape: '4:5',
    platform: 'facebook',
    label: 'Facebook post',
    version: 1,
    structure: 'single',
    limits: { count: 'utf16', maxChars: 2000, targetChars: 600, foldChars: null },
    hashtags: { min: 0, max: 2 },
    links: { inBody: 'ok', fallback: 'first_comment' },
    rules: [
      'Facebook cuts long posts behind "See more": make the first line work on its own.',
      'Short paragraphs. Shorter and warmer than a LinkedIn post.',
      'Links may go in the post itself; Facebook shows a preview card.',
      'Plain text: no markdown.'
    ],
    commentLabel: 'First comment'
  },
  // A feed post: a picture with its caption. The id is older than the label.
  'instagram.caption': {
    id: 'instagram.caption',
    // Instagram refuses a post without media: an image or a carousel.
    media: {
      formats: ['image', 'carousel'],
      carousel: {
        minSlides: 2,
        maxSlides: 10,
        targetSlides: { min: 5, max: 8 },
        delivery: 'images'
      }
    },
    imageShape: '4:5',
    platform: 'instagram',
    label: 'Instagram post',
    // 2: the visual is one image or a carousel, as the post's media format says.
    version: 2,
    structure: 'single',
    limits: { count: 'utf16', maxChars: 2200, targetChars: 800, foldChars: 125 },
    hashtags: { min: 1, max: 5 },
    links: { inBody: 'not_clickable', fallback: 'link_in_bio' },
    rules: [
      'The first 125 characters show before "more": the hook must be a complete thought within them.',
      'The caption goes with the post\'s visual (one image, or a carousel when the request says so). Describe that visual in visualIdea.',
      'Short paragraphs separated by line breaks. Plain text: no markdown.',
      'Links are not clickable in captions. Never write a URL; say the link is in the bio.',
      'Hashtags go at the end, in addition to the caption text.'
    ],
    commentLabel: 'Link-in-bio note',
    withImage: true
  },
  'instagram.reel': {
    id: 'instagram.reel',
    media: { formats: ['video'] },
    imageShape: '4:5',
    platform: 'instagram',
    label: 'Instagram Reel',
    version: 1,
    structure: 'script',
    limits: {
      count: 'utf16',
      maxChars: 2200,
      targetChars: 300,
      foldChars: 125,
      seconds: { target: 30, max: 90 }
    },
    hashtags: { min: 1, max: 5 },
    links: { inBody: 'not_clickable', fallback: 'link_in_bio' },
    rules: [
      'A vertical video script, shot by shot, to be filmed by the author: what is said, what is on screen, and any text overlay.',
      'The first shot is the hook: it earns the next three seconds, in words and in picture.',
      'Write the spoken words to be said aloud: short sentences, contractions, no lists read out.',
      'The caption goes with the video: its first 125 characters show before "more". Never write a URL; say the link is in the bio.'
    ],
    commentLabel: 'Pinned comment',
    register:
      'Spoken, personal and quick, to one viewer. Short sentences that sound natural out loud; the picture carries as much as the words.',
    opening:
      'A spoken first line, within two seconds, that makes the viewer want the rest, while the picture already shows something worth watching.'
  },
  'youtube.short': {
    id: 'youtube.short',
    media: { formats: ['video'] },
    imageShape: '4:5',
    platform: 'youtube',
    label: 'YouTube Short',
    version: 1,
    structure: 'script',
    limits: {
      count: 'utf16',
      maxChars: 5000,
      targetChars: 300,
      foldChars: null,
      seconds: { target: 45, max: 180 }
    },
    hashtags: { min: 1, max: 3 },
    links: { inBody: 'not_clickable', fallback: 'link_in_bio' },
    rules: [
      'A vertical video script, shot by shot, to be filmed by the author: what is said, what is on screen, and any text overlay.',
      'The first shot states what the viewer will get; the rest delivers it, one step per shot.',
      'Write the spoken words to be said aloud: short sentences, contractions, no lists read out.',
      'The title (at most 100 characters) says exactly what the viewer gets, in the words they would search. The description adds context; links in a Short description are not clickable, so point to the channel instead.'
    ],
    commentLabel: 'Pinned comment'
  }
}

/**
 * The formats new posts can be created in, from ideas or as another version:
 * every one above but the video scripts (Instagram Reels, YouTube Shorts).
 * The app offers no Reel, video or script anywhere; scripts written before
 * stay readable and editable.
 */
export const CREATABLE_FORMATS: readonly FormatId[] = FORMAT_IDS.filter(
  id => FORMATS[id].structure !== 'script'
)

export const isCreatableFormat = (id: FormatId) => CREATABLE_FORMATS.includes(id)

/** A post in this format can carry an image: every format but a video script. */
export const canHaveImage = (id: FormatId) => FORMATS[id].structure !== 'script'

/** A post in this format cannot go out without an image (an Instagram post). */
export const needsImage = (id: FormatId) => Boolean(FORMATS[id].withImage)

/**
 * The platforms posts can be created for: those with a creatable format.
 * Not YouTube, whose only format was the Short script. Pickers (setup,
 * Preferences, the AI setup) offer these.
 */
export const CREATABLE_PLATFORMS: readonly PlatformId[] = PLATFORM_IDS.filter(p =>
  CREATABLE_FORMATS.some(f => FORMATS[f].platform === p)
)

export const isCreatablePlatform = (id: PlatformId) => CREATABLE_PLATFORMS.includes(id)

export const formatSpec = (id: FormatId): FormatSpec => FORMATS[id]

export const platformOf = (id: FormatId): PlatformInfo =>
  PLATFORMS[FORMATS[id].platform]

export function isFormatId(value: unknown): value is FormatId {
  return typeof value === 'string' && (FORMAT_IDS as readonly string[]).includes(value)
}

export { isPlatformId }

/** The format a stored post was written in; rows from before formats are LinkedIn. */
export function formatOf(value: string | null | undefined): FormatId {
  return isFormatId(value) ? value : DEFAULT_FORMAT
}

/** Known formats only, each once, in registry order. */
export function cleanFormats(values: unknown): FormatId[] {
  if (!Array.isArray(values)) return []
  const wanted = new Set(values.filter(isFormatId))
  return FORMAT_IDS.filter(id => wanted.has(id))
}

export function formatsOfPlatform(platform: PlatformId): FormatId[] {
  return FORMAT_IDS.filter(id => FORMATS[id].platform === platform)
}

/** The platforms the given formats belong to, in registry order. */
export function platformsOf(formats: FormatId[]): PlatformId[] {
  const used = new Set(formats.map(f => FORMATS[f].platform))
  return PLATFORM_IDS.filter(p => used.has(p))
}

/** What a format is, in a few words, for pickers. */
export function formatHint(id: FormatId): string {
  const { structure, limits, withImage } = FORMATS[id]
  if (withImage) {
    return `A picture with its caption, up to ${limits.maxChars.toLocaleString('en-US')} characters`
  }
  if (structure === 'thread' && limits.parts) {
    return `${limits.parts.min}–${limits.parts.max} posts, each up to ${limits.maxChars} characters`
  }
  if (structure === 'script') return 'A short video script and its caption'
  return `One post, up to ${limits.maxChars.toLocaleString('en-US')} characters`
}

/** "LinkedIn post, X thread and Instagram caption". */
export function describeFormats(formats: FormatId[]): string {
  const labels = formats.map(f => FORMATS[f].label)
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}
