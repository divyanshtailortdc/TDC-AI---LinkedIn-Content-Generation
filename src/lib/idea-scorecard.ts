import type { SourceRating } from './research/source-credibility'

/**
 * How an idea scores, one dimension at a time, each with the reason a person
 * approving it can read. Kept separate on purpose:
 *
 * - goal fit (its own columns, from the review): does it achieve its goal?
 * - originality, trend relevance, brand fit, engagement potential: judged by
 *   the idea review (src/lib/ai/skills/goal-review), originality also
 *   measured against the account's earlier ideas by meaning.
 * - source quality: computed, never judged by a model, and only over the
 *   facts the idea states. An idea that states none needs no sources, and is
 *   not marked down for it: source quality says how far its FACTS can be
 *   trusted, not how good the idea is.
 *
 * Free of dependencies beyond types, so the schema, the server and the
 * browser all read the same definitions.
 */

export type ScoreWithReason = { score: number; reason: string }

/**
 * not_needed: the idea states no facts that need a source. strong / mixed /
 * weak: how far the sources behind its facts can be trusted.
 */
export type SourcesStatus = 'not_needed' | 'strong' | 'mixed' | 'weak'

export type SourcesScore = {
  status: SourcesStatus
  /** 0-100; null when no source is needed. */
  score: number | null
  reason: string
  /** Factual claims the idea makes, kept and dropped. */
  claims: number
  /** Claims no source backed, dropped from the idea. */
  dropped: number
}

export type IdeaScorecard = {
  originality?: ScoreWithReason
  trendRelevance?: ScoreWithReason
  brandFit?: ScoreWithReason
  engagement?: ScoreWithReason
  sources?: SourcesScore
}

/** The judged dimensions, in the order the card lists them after goal fit. */
export const JUDGED_DIMENSIONS = [
  'engagement',
  'originality',
  'trendRelevance',
  'brandFit'
] as const

export type JudgedDimension = (typeof JUDGED_DIMENSIONS)[number]

export const DIMENSION_LABELS: Record<JudgedDimension | 'goalFit' | 'sources', string> = {
  goalFit: 'Goal fit',
  engagement: 'Engagement potential',
  originality: 'Originality',
  trendRelevance: 'Trend relevance',
  brandFit: 'Brand fit',
  sources: 'Source quality'
}

/** At or above: the facts rest on sources that can be trusted. */
export const STRONG_SOURCES = 75
/** Below: the card warns that the idea's facts are weakly sourced. */
export const WEAK_SOURCES = 55

export function sourcesStatusFor(score: number): Exclude<SourcesStatus, 'not_needed'> {
  if (score >= STRONG_SOURCES) return 'strong'
  if (score >= WEAK_SOURCES) return 'mixed'
  return 'weak'
}

/** A kept supporting claim, as the source score sees it. */
export type ScoredClaim = {
  /** The cited source states it (rather than only supporting it in part). */
  direct: boolean
  credibility: SourceRating
  /** "The Economic Times", "zomato.com". */
  sourceName?: string
  publishedAt?: string
}

/** A claim its source only partly states counts for this share of its source's score. */
const INFERRED_WEIGHT = 0.8

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`

/**
 * How far an idea's facts can be trusted: the mean, over every factual claim
 * it made, of its source's credibility (a claim its source only partly
 * states counts for less, and a claim nothing backed counts as zero). With no
 * claims, no source is needed.
 */
export function scoreSources(kept: ScoredClaim[], dropped: number): SourcesScore {
  const claims = kept.length + dropped
  if (claims === 0) {
    return {
      status: 'not_needed',
      score: null,
      reason:
        'It states no facts that need a source: it rests on the account’s own voice and a creative angle.',
      claims: 0,
      dropped: 0
    }
  }
  const total = kept.reduce(
    (sum, c) => sum + c.credibility.score * (c.direct ? 1 : INFERRED_WEIGHT),
    0
  )
  const score = Math.round(total / claims)

  // "1 from established news (The Economic Times, 2026-11-12), 1 from your knowledge base"
  const groups = new Map<string, ScoredClaim[]>()
  for (const c of kept) {
    const list = groups.get(c.credibility.label) ?? []
    list.push(c)
    groups.set(c.credibility.label, list)
  }
  const parts = [...groups.entries()]
    .sort((a, b) => b[1][0]!.credibility.score - a[1][0]!.credibility.score)
    .map(([label, list]) => {
      const names = Array.from(
        new Set(
          list
            .map(c => [c.sourceName, c.publishedAt?.slice(0, 10)].filter(Boolean).join(', '))
            .filter(Boolean)
        )
      ).slice(0, 2)
      return `${list.length} from ${label.charAt(0).toLowerCase()}${label.slice(1)}${names.length > 0 ? ` (${names.join('; ')})` : ''}`
    })
  const sentences = [
    kept.length > 0
      ? `${plural(claims, 'factual claim')}: ${parts.join(', ')}.`
      : `${plural(claims, 'factual claim')}, none of them backed by a source.`
  ]
  const partly = kept.filter(c => !c.direct).length
  if (partly > 0) {
    sentences.push(
      `${partly === kept.length && partly === 1 ? 'Its source only partly states it' : `${partly} of them only partly stated by ${partly === 1 ? 'its source' : 'their sources'}`}, so ${partly === 1 ? 'it counts' : 'they count'} for less.`
    )
  }
  if (dropped > 0 && kept.length > 0) {
    sentences.push(
      `${dropped} more could not be verified and ${dropped === 1 ? 'was' : 'were'} dropped.`
    )
  }
  if (kept.length > 0 && kept.every(c => c.credibility.tier === 'social' || c.credibility.tier === 'forum')) {
    sentences.push('Social posts and forums show what people say, not proven facts.')
  }
  // Another market's page, or a site nobody has rated: worth a look. (What
  // social posts are good for is said above.)
  const notes = Array.from(
    new Set(
      kept
        .filter(c => c.credibility.tier !== 'social' && c.credibility.tier !== 'forum')
        .map(c => c.credibility.note)
        .filter((n): n is string => !!n)
    )
  ).slice(0, 2)
  for (const note of notes) sentences.push(`${note.charAt(0).toUpperCase()}${note.slice(1)}.`)

  return {
    status: sourcesStatusFor(score),
    score,
    reason: sentences.join(' '),
    claims,
    dropped
  }
}

/**
 * At or above this similarity in meaning an idea is close to an earlier one,
 * though not the same (that is 0.82, src/lib/ai/semantic-repeats). On the
 * account it was calibrated on, genuinely different ideas scored 0.75 at
 * most and a reworded one 0.88.
 */
export const CLOSE_TO_EARLIER = 0.78
/** The most originality an idea close to an earlier one can have. */
const CLOSE_ORIGINALITY_CAP = 65

/**
 * Originality, measured as well as judged: an idea close in meaning to one
 * the account already has is capped, and its reason names that idea.
 */
export function withMeasuredNovelty<
  T extends { scorecard?: IdeaScorecard; originalityScore?: number }
>(idea: T, closest: { title: string; similarity: number } | null): T {
  if (!closest || closest.similarity < CLOSE_TO_EARLIER) return idea
  const note = `Close in meaning to the earlier idea “${closest.title}” (${Math.round(closest.similarity * 100)}% alike).`
  const judged = idea.scorecard?.originality
  const score = Math.min(judged?.score ?? idea.originalityScore ?? 80, CLOSE_ORIGINALITY_CAP)
  return {
    ...idea,
    originalityScore: score,
    scorecard: {
      ...idea.scorecard,
      originality: { score, reason: judged?.reason ? `${note} ${judged.reason}` : note }
    }
  }
}

/**
 * Whether the card should warn that an idea's facts are thinly sourced. Only
 * for ideas that state facts: an idea with none is never "weakly sourced".
 * Ideas saved before the scorecard warn only when a claim of theirs was
 * dropped, which is the case the old score was meant to catch.
 */
export function hasWeakSources(idea: {
  scorecard?: IdeaScorecard | null
  groundingScore?: number | null
  unsupportedClaims?: string[] | null
}): boolean {
  const sources = idea.scorecard?.sources
  if (sources) return sources.status === 'weak'
  return (
    typeof idea.groundingScore === 'number' &&
    idea.groundingScore < 60 &&
    (idea.unsupportedClaims?.length ?? 0) > 0
  )
}
