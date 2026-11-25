/**
 * What one post cost in AI: every model call tagged with it in the usage
 * ledger (ai_usage.draft_id), from writing it (the draft, its revision pass,
 * its image or slides, its video) to every rewrite and regeneration since.
 * Research and ideation serve a whole run, not one post, so they are not in
 * it. Posts from before calls were tagged have none.
 *
 * Pure: the posts pages and tests read it.
 */

export interface PostUsageStage {
  stage: string
  label: string
  calls: number
  totalTokens: number
  costUsd: number
}

export interface PostUsage {
  costUsd: number
  calls: number
  inputTokens: number
  outputTokens: number
  /** Input and output, thinking included. */
  totalTokens: number
  /** Some of the cost is the rate-table estimate, not the provider's bill. */
  estimated: boolean
  /** By kind of work, the costliest first. */
  stages: PostUsageStage[]
}

const STAGE_LABELS: Record<string, string> = {
  drafting: 'Writing',
  linting: 'Revision',
  media_brief: 'Image planning',
  media_review: 'Image check',
  image: 'Image',
  video_look: 'Video look',
  embedding: 'Embedding'
}

export const postUsageStageLabel = (stage: string) =>
  STAGE_LABELS[stage] ??
  stage.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

/** One ledger row per post and stage, as the loader sums them. */
export interface PostUsageRow {
  draftId: string
  stage: string
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  estimated: boolean
}

/** Each post's usage from its stage rows; posts with no rows are absent. */
export function summarizePostUsage(
  rows: PostUsageRow[]
): Map<string, PostUsage> {
  const byDraft = new Map<string, PostUsage>()
  for (const row of rows) {
    const usage = byDraft.get(row.draftId) ?? {
      costUsd: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimated: false,
      stages: []
    }
    usage.costUsd += row.costUsd
    usage.calls += row.calls
    usage.inputTokens += row.inputTokens
    usage.outputTokens += row.outputTokens
    usage.totalTokens += row.totalTokens
    usage.estimated ||= row.estimated
    usage.stages.push({
      stage: row.stage,
      label: postUsageStageLabel(row.stage),
      calls: row.calls,
      totalTokens: row.totalTokens,
      costUsd: row.costUsd
    })
    byDraft.set(row.draftId, usage)
  }
  for (const usage of byDraft.values()) {
    usage.stages.sort(
      (a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens
    )
  }
  return byDraft
}

/** "$0.0734", or "<$0.0001"; four places, since a post costs cents. */
export function formatPostCost(usd: number): string {
  if (usd > 0 && usd < 0.0001) return '<$0.0001'
  return `$${usd.toFixed(usd >= 1 ? 2 : 4)}`
}

/** "18.2k", "1.4M", "940". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}
