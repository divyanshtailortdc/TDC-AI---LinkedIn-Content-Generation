/**
 * The looks this account's latest images and carousels were made in, so the
 * art director can make the next one look different. Without them each image
 * was designed on its own, and an account whose posts are mostly one kind
 * (Zomato's red text cards) got that same card on every post and every
 * carousel (2026-11-24). Pure, for tests; loaded by loadRecentLooks.
 */

/** How many of the latest looks the art director is shown. */
export const RECENT_LOOKS_SHOWN = 4

/** A look an image or a carousel of this account was made in. */
export type RecentLook = {
  /** A carousel, whose cover stands for the set. */
  carousel: boolean
  kind: 'photo' | 'graphic'
  styleNotes: string
  /** What it showed. */
  concept: string
  /** The example posts it followed (visual_examples ids); empty when not recorded. */
  exampleIds: string[]
}

/** A recent look as the art director is shown it: the examples it followed by their number in the list shown now. */
export type RecentLookInput = Omit<RecentLook, 'exampleIds'> & {
  examples: number[]
}

const flat = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

/**
 * A stored look: an image's `metadata.look` (its concept is the image's own,
 * passed in) or a carousel slide's. Null when it is not one.
 */
export function recentLookOf(
  look: unknown,
  options: { carousel: boolean; concept?: string | null }
): RecentLook | null {
  if (!look || typeof look !== 'object' || Array.isArray(look)) return null
  const raw = look as Record<string, unknown>
  const styleNotes = flat(raw.styleNotes)
  if (!styleNotes) return null
  return {
    carousel: options.carousel,
    kind: raw.kind === 'photo' ? 'photo' : 'graphic',
    styleNotes,
    concept: flat(options.concept) || flat(raw.concept),
    exampleIds: Array.isArray(raw.exampleIds)
      ? raw.exampleIds.filter((id): id is string => typeof id === 'string')
      : []
  }
}

/** Each look's examples by their 1-based place in `examples`; ones no longer there are left out. */
export function numberRecentLooks(
  recent: readonly RecentLook[],
  examples: ReadonlyArray<{ id?: string }>
): RecentLookInput[] {
  return recent.map(({ exampleIds, ...look }) => ({
    ...look,
    examples: exampleIds
      .map(id => examples.findIndex(e => e.id === id) + 1)
      .filter(n => n > 0)
      .sort((a, b) => a - b)
  }))
}
