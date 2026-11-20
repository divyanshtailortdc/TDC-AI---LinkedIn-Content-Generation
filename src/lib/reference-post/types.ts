/**
 * A public post someone shared as a model for a post of their own: "write me
 * one like this". Read once from its link (./read.ts), shown in the dialog
 * for the user to check or complete, then kept on the idea made from it
 * (ideas.reference), where the drafting prompts read it.
 *
 * Free of dependencies, so the schema, the server and the browser all read
 * the same definitions.
 */

/** Where a reference link points: a platform the app knows, TikTok, or any other web page. */
export const REFERENCE_SOURCES = [
  'linkedin',
  'x',
  'instagram',
  'facebook',
  'threads',
  'youtube',
  'tiktok',
  'web'
] as const
export type ReferenceSource = (typeof REFERENCE_SOURCES)[number]

export const REFERENCE_SOURCE_LABELS: Record<ReferenceSource, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  web: 'Web page'
}

/**
 * What the shared post is, as its address (or what was read) says: a post,
 * a reel or video, a photo, a carousel of several images, or an article.
 */
export const REFERENCE_KINDS = [
  'post',
  'reel',
  'video',
  'photo',
  'carousel',
  'article'
] as const
export type ReferenceKind = (typeof REFERENCE_KINDS)[number]

/**
 * How the text was got: a platform's public embed API (oembed), the search
 * engine's copy (search), the page itself (page: articles only), or typed
 * in by the user (pasted).
 */
export type ReferenceVia = 'oembed' | 'search' | 'page' | 'pasted'

export type ReferencePost = {
  /** The link as shared, tidied (https, no tracking parameters). */
  url: string
  source: ReferenceSource
  kind: ReferenceKind
  /** Who posted it, as the platform names them; absent when unknown. */
  author?: string
  /** A video's or article's title, when it has one apart from its text. */
  title?: string
  /** What it says: the caption, the post's text, a video's description, an article's text. */
  text: string
  /**
   * Only part of it could be read (the search engine shows a post's
   * opening), so the user is asked to paste the rest for a closer match.
   */
  partial: boolean
  via: ReferenceVia
  /**
   * A small copy of its picture or cover, from a host that may be fetched
   * (the search engine's thumbnails, YouTube's): the model looks at it.
   */
  imageUrl?: string
  /**
   * How it is built (its opening, sequence, length, devices), as the model
   * read it when the idea was made; drafting copies the build, not the words.
   */
  structure?: string
}

/** Longest reference text kept and shown to the model: a long article is cut. */
export const REFERENCE_TEXT_MAX = 6000

/** Shortest text worth writing from: less than this, the user is asked to paste it. */
export const REFERENCE_TEXT_MIN = 20

/** Where a shared post is and what it is, without its text: what idea cards show. */
export type SharedPostRef = Pick<ReferencePost, 'url' | 'source' | 'kind'> & {
  author?: string | null
}
