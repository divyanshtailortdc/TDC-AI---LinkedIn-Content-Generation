import type { PlatformId } from '../platforms'
import { VISUAL_EXAMPLE_LIMITS, type VisualExampleSource } from './types'

/** An example as stored, without its bytes. */
export type StoredExample = {
  platform: PlatformId
  source: VisualExampleSource
  imageUrl: string
  width: number | null
  height: number | null
  createdAt: Date
}

/**
 * Which examples a new image for `platform` follows: that platform's own
 * when it has any, uploads first (the user chose them), then the newest
 * found; otherwise the identity's other platforms', the platform with the
 * most first, since an account's look usually carries across platforms.
 * At most VISUAL_EXAMPLE_LIMITS.shownToDirector. Pure, for tests.
 */
export function pickLookExamples<T extends StoredExample>(
  rows: readonly T[],
  platform: PlatformId
): T[] {
  const order = (a: T, b: T) =>
    Number(b.source === 'upload') - Number(a.source === 'upload') ||
    b.createdAt.getTime() - a.createdAt.getTime()
  const own = rows.filter(r => r.platform === platform)
  const limit = VISUAL_EXAMPLE_LIMITS.shownToDirector
  if (own.length > 0) return [...own].sort(order).slice(0, limit)

  const byPlatform = new Map<PlatformId, T[]>()
  for (const row of rows) {
    byPlatform.set(row.platform, [...(byPlatform.get(row.platform) ?? []), row])
  }
  return [...byPlatform.values()]
    .sort((a, b) => b.length - a.length)
    .flatMap(list => [...list].sort(order))
    .slice(0, limit)
}
