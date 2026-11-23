import type { StoryUse } from './status'

/**
 * Comparing two versions of one newsletter issue: which stories they share
 * (extract-email.ts, reconcileVersions). No imports beyond types, so it can be
 * tested on its own.
 */

/** A story as versions of an issue are compared: stored, or about to be. */
export type ComparedStory = {
  articleId: string | null
  url: string | null
  headline: string
  isSponsored: boolean
}

/**
 * What identifies a story in another email: its article (or its link, when
 * it leads to no article) and its headline's words, so a story whose link a
 * correction fixed still matches. Short headlines ("Read more") do not
 * count, and a sponsored story never matches.
 */
function storyKeys(story: ComparedStory): string[] {
  if (story.isSponsored) return []
  const keys: string[] = []
  if (story.articleId) keys.push(`article:${story.articleId}`)
  else if (story.url) keys.push(`url:${story.url}`)
  const words = story.headline
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (words.length >= 3) keys.push(`headline:${words.join(' ')}`)
  return keys
}

/**
 * How alike two emails' stories are: the stories they share over all the
 * stories of both (0 to 1), and which of each side's stories the other has.
 */
export function compareStories(a: ComparedStory[], b: ComparedStory[]) {
  const aKeys = a.map(storyKeys)
  const bKeys = b.map(storyKeys)
  const inA = new Set(aKeys.flat())
  const inB = new Set(bKeys.flat())
  const aShared = aKeys.flatMap((keys, i) =>
    keys.some(key => inB.has(key)) ? [i] : []
  )
  const bShared = bKeys.flatMap((keys, i) =>
    keys.some(key => inA.has(key)) ? [i] : []
  )
  const aCount = aKeys.filter(keys => keys.length > 0).length
  const bCount = bKeys.filter(keys => keys.length > 0).length
  const shared = Math.min(aShared.length, bShared.length)
  const all = aCount + bCount - shared
  return { overlap: all > 0 ? shared / all : 0, aShared, bShared }
}

/**
 * Which stored story of older versions carries each story of a newer one:
 * pairs of [index in `stories`, index in `older`], each story in at most one
 * pair. A stored story the user chose for (Keep or Don't use) is paired
 * first, so the choice survives when two stored stories match one new one;
 * then the closest match (more keys in common). `skip` are new stories that
 * take none (a still newer version already carries them).
 */
export function pairStories(
  stories: ComparedStory[],
  older: Array<ComparedStory & { useInIdeas: StoryUse }>,
  skip: ReadonlySet<number> = new Set()
): Array<[number, number]> {
  const newKeys = stories.map(storyKeys)
  const candidates = older.flatMap((story, j) => {
    const keys = storyKeys(story)
    const chosen = story.useInIdeas !== 'auto'
    return newKeys.flatMap((theirs, i) => {
      if (skip.has(i)) return []
      const common = keys.filter(key => theirs.includes(key)).length
      return common > 0 ? [{ i, j, chosen, common }] : []
    })
  })
  candidates.sort(
    (x, y) =>
      Number(y.chosen) - Number(x.chosen) ||
      y.common - x.common ||
      x.j - y.j ||
      x.i - y.i
  )
  const pairedNew = new Set<number>()
  const pairedOld = new Set<number>()
  const pairs: Array<[number, number]> = []
  for (const { i, j } of candidates) {
    if (pairedNew.has(i) || pairedOld.has(j)) continue
    pairedNew.add(i)
    pairedOld.add(j)
    pairs.push([i, j])
  }
  return pairs
}
