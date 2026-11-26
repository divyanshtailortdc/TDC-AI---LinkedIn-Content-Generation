import { FORMATS, type FormatId } from '@/lib/formats'
import { overLimitMessage } from '@/lib/formats/text'
import type { PlatformId } from '@/lib/platforms'
import {
  postTextOf,
  VIDEO_TITLE_MAX,
  type MediaPostDraft
} from '~/lib/media-upload/drafts'
import type { MediaPostItem } from './schema'

/**
 * Turns the model's posts into drafts the page can show: one per platform
 * asked for, in that order, each held to its platform's rules where they can
 * be fixed without rewriting (hashtag count, links where they do not work,
 * markdown, a title only where there is one). What is left over the length
 * limit is reported, to shorten.
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

/** Hashtags as stored: no #, letters and digits only, each once, at most `max`. */
export function cleanHashtags(tags: readonly string[], max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const word = raw.replace(/[^\p{L}\p{N}\p{M}_]/gu, '')
    if (!word || seen.has(word.toLowerCase())) continue
    seen.add(word.toLowerCase())
    out.push(word)
    if (out.length >= max) break
  }
  return out
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
  return {
    platform,
    formatId,
    hook: text(item?.hook),
    body: text(item?.body),
    cta: text(item?.cta),
    hashtags: cleanHashtags(
      item?.hashtags ?? [],
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
