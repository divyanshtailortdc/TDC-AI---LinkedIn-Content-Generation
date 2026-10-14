import type { DraftGenerationResult } from './schema'

/**
 * A draft without a hook or body is unusable, whatever else came back.
 * Platform rules (length, banned words, hashtags, citations) are the linter's
 * job in src/lib/lint, run by the drafting pipeline.
 */
export function isCompleteDraft(
  draft: DraftGenerationResult | null | undefined
): draft is DraftGenerationResult {
  return Boolean(draft?.hook?.trim() && draft?.body?.trim())
}
