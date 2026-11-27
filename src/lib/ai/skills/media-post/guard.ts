import { FORMATS, type FormatId } from '@/lib/formats'
import { overLimitMessage } from '@/lib/formats/text'
import type { PlatformId } from '@/lib/platforms'
import {
  postTextOf,
  VIDEO_TITLE_MAX,
  type MediaPostDraft
} from '~/lib/media-upload/drafts'
import { withoutRepeatedHook } from '../post-drafting/guard'
import type { MediaPostItem } from './schema'

/**
 * Turns the model's posts into drafts the page can show: one per platform
 * asked for, in that order, each held to its platform's rules where they can
 * be fixed without rewriting (hashtag count and form, hashtags written into
 * the text, links where they do not work, markdown, a body repeating the
 * hook, a title only where there is one). What is left over the length
 * limit, or fails the writing checks (./quality), is rewritten once.
 */

const URL = /\bhttps?:\/\/[^\s<>]+|\bwww\.[^\s<>]+/gi

/** Plain text: no markdown bold or headings, trimmed. */
export function plainText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * One hashtag from what the model wrote for it: several words become one in
 * CamelCase ("order tracking" → OrderTracking), so screen readers and
 * readers see the words, and only letters and digits are kept.
 */
function hashtagWord(raw: string): string {
  const parts = raw.trim().split(/[\s_-]+/).filter(Boolean)
  const joined =
    parts.length > 1
      ? parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')
      : (parts[0] ?? '')
  return joined.replace(/[^\p{L}\p{N}\p{M}_]/gu, '')
}

/** A word already written as a tag: CamelCase or mixed case inside it ("OrderTracking", "eCommerce", "SaaS"). */
const CASED_TAG = /\p{Ll}\p{Lu}/u

/**
 * One item the model sent, as the tags it holds: split at #, commas and
 * semicolons, and at spaces when its words are already tags of their own
 * ("OrderTracking CustomerExperience" is two tags, where "order tracking"
 * is one, OrderTracking).
 */
function tagsIn(raw: string): string[] {
  return raw.split(/[#,;]+/).flatMap(part => {
    const words = part.trim().split(/\s+/).filter(Boolean)
    return words.length > 1 && words.some(word => CASED_TAG.test(word))
      ? words
      : [part]
  })
}

/**
 * Hashtags as stored: no #, letters and digits only, each once, at most
 * `max`. Several tags sent as one ("#AI #SaaS", "AI, SaaS",
 * "OrderTracking CustomerExperience") are split, and a tag with no letter
 * ("#1") is no hashtag.
 */
export function cleanHashtags(tags: readonly string[], max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of tags.flatMap(tagsIn)) {
    if (out.length >= max) break
    const word = hashtagWord(part)
    if (!word || !/\p{L}/u.test(word) || seen.has(word.toLowerCase())) continue
    seen.add(word.toLowerCase())
    out.push(word)
  }
  return out
}

/** A hashtag in text: # and a word with a letter in it. */
const TAG_IN_TEXT = /#(?=[\p{N}_]*\p{L})[\p{L}\p{N}\p{M}_]+/gu
/** A run of hashtags ending the text, on the last line or after the last sentence. */
const TRAILING_TAGS =
  /(?:^|\s)((?:#(?=[\p{N}_]*\p{L})[\p{L}\p{N}\p{M}_]+[\s,]*)+)$/u

/**
 * Hashtags the model wrote into the text instead of the hashtags field: a
 * run of them ending the text (on its own line, after a finished sentence,
 * or two tags or more) is taken out and returned, to join the others; tags
 * glued together ("#AI#SaaS") are spaced. A tag a sentence ends on ("proud
 * of the team at #TDC") and tags inside a sentence stay where they are.
 */
export function tagsOutOfText(text: string): { text: string; tags: string[] } {
  const spaced = text
    .replace(/(#[\p{L}\p{N}\p{M}_]+)(?=#)/gu, '$1 ')
    .replace(/([.?!:;,)])(?=#(?=[\p{N}_]*\p{L}))/gu, '$1 ')
  const trailing = TRAILING_TAGS.exec(spaced)
  if (!trailing) return { text: spaced, tags: [] }
  const tags = (trailing[1]!.match(TAG_IN_TEXT) ?? []).map(tag => tag.slice(1))
  const before = spaced.slice(0, trailing.index)
  const apart =
    tags.length >= 2 ||
    !before.trim() ||
    /\n\s*$/.test(before + trailing[0].match(/^\s*/)![0]) ||
    /[.?!…:)]$/.test(before.trimEnd())
  if (!apart) return { text: spaced, tags: [] }
  return { text: before.trimEnd(), tags }
}

/**
 * With no call to action, a body ending on a question has its closing
 * question there: it is moved to the call to action, where the page and the
 * checks look for it. The posted text is the same (paragraphs either way).
 */
export function withClosingQuestion<
  T extends { body: string; cta: string }
>(post: T): T {
  if (post.cta.trim()) return post
  const paragraphs = post.body.split(/\n\s*\n/)
  const last = paragraphs[paragraphs.length - 1]?.trim() ?? ''
  if (paragraphs.length < 2 || !last.endsWith('?') || last.length > 300)
    return post
  return {
    ...post,
    body: paragraphs.slice(0, -1).join('\n\n').trim(),
    cta: last
  }
}

/** Most hashtags a format's post takes; LinkedIn's follow the author's policy. */
export function maxHashtagsOf(formatId: FormatId, voiceMax: number): number {
  const rule = FORMATS[formatId].hashtags
  return rule === 'voice' ? voiceMax : rule.max
}

/** A link where links are not clickable (an Instagram caption) is taken out. */
const withoutLinks = (formatId: FormatId, text: string) =>
  FORMATS[formatId].links.inBody === 'not_clickable'
    ? text
        .replace(URL, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim()
    : text

export function toDraft(
  platform: PlatformId,
  formatId: FormatId,
  item: MediaPostItem | undefined,
  options: { kind: 'image' | 'video'; voiceMaxHashtags: number }
): MediaPostDraft {
  const text = (value: string | undefined) =>
    withoutLinks(formatId, plainText(value ?? ''))
  const body = tagsOutOfText(text(item?.body))
  const cta = tagsOutOfText(text(item?.cta))
  const written = withoutRepeatedHook(
    withClosingQuestion({ hook: text(item?.hook), body: body.text, cta: cta.text })
  )
  return {
    platform,
    formatId,
    hook: written.hook,
    body: written.body,
    cta: written.cta,
    hashtags: cleanHashtags(
      [...(item?.hashtags ?? []), ...body.tags, ...cta.tags],
      maxHashtagsOf(formatId, options.voiceMaxHashtags)
    ),
    firstComment: plainText(item?.firstComment ?? ''),
    title:
      FORMATS[formatId].structure === 'script'
        ? plainText(item?.title ?? '')
            .replace(/\s+/g, ' ')
            .slice(0, VIDEO_TITLE_MAX)
        : '',
    altText:
      options.kind === 'image'
        ? plainText(item?.altText ?? '')
            .replace(/\s+/g, ' ')
            .slice(0, 1000)
        : ''
  }
}

/** The model's post for a platform: matched by id, case and spaces ignored. */
export function itemFor(
  items: readonly MediaPostItem[],
  platform: PlatformId
): MediaPostItem | undefined {
  return items.find(item => item.platform.trim().toLowerCase() === platform)
}

/** The drafts still over their platform's length, to shorten. */
export const overLimit = (drafts: readonly MediaPostDraft[]) =>
  drafts.filter(
    draft => overLimitMessage(draft.formatId, postTextOf(draft)) !== null
  )
