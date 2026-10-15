/**
 * Which model the app uses, in a file with no dependencies so the cost
 * accounting in `usage.ts` (kept free of env so it can be unit tested) can
 * share it. `src/lib/ai.ts` re-exports these.
 */

/** Reasoning-heavy work: ideation, drafting and AI setup. */
export const defaultModel = 'claude-sonnet-5-5'
/** Bulk extraction where judgment matters less than throughput. */
export const fastModel = 'claude-haiku-4-5'
