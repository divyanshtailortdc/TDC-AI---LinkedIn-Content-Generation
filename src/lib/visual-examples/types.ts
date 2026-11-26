import type { PlatformId } from '../platforms'

/**
 * Example posts: images an identity has posted on a platform, kept so that
 * new images can be made to look like them (src/lib/media/learned-look.ts).
 * Some come from the profile analysis (the search engine's copies of its
 * public posts, or the posts Buffer sent on its channel) and are replaced
 * each time the profile is read again; the rest the user uploaded, and stay
 * until removed.
 *
 * Free of dependencies beyond types, so the schema, the server and the
 * browser read the same definitions.
 */
export const VISUAL_EXAMPLE_SOURCES = ['search', 'buffer', 'upload'] as const
export type VisualExampleSource = (typeof VISUAL_EXAMPLE_SOURCES)[number]

/** The sources a profile analysis writes, and replaces each time. */
export const LEARNED_SOURCES: readonly VisualExampleSource[] = [
  'search',
  'buffer'
]

export const VISUAL_EXAMPLE_LIMITS = {
  /** Kept from one profile analysis. */
  learned: 12,
  /** Uploaded per identity and platform. */
  uploads: 12,
  /** The largest file accepted, before it is downscaled. */
  uploadBytes: 8 * 1024 * 1024,
  /** Uploads are stored no larger than this on their long side. */
  storedSide: 1536,
  /** Shown to the art director, which picks the ones to follow. */
  shownToDirector: 8
} as const

export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/** An example as the Profile page shows it. */
export type VisualExampleView = {
  id: string
  platform: PlatformId
  source: VisualExampleSource
  /** A link the browser can load (signed when stored). */
  url: string
  postUrl: string | null
  width: number | null
  height: number | null
}
