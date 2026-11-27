/**
 * Which model the app uses, in a file with no dependencies so the cost
 * accounting in `usage.ts` (kept free of env so it can be unit tested) can
 * share it. `src/lib/ai.ts` re-exports these.
 */

/** Reasoning-heavy work: ideation, drafting and AI setup. */
export const defaultModel = 'claude-sonnet-5-5'
/**
 * Mechanical work where judgment matters less than throughput: extracting
 * facts from a document or email, picking links or pages from a list,
 * writing a few search phrases. Haiku 5.5 is the current Haiku, at a tenth
 * of Haiku 4.5's price ($0.10 / $0.50 per million tokens against $1 / $5)
 * and a twentieth of Sonnet 5.5's. A call on it that fails outright is made
 * once more on the default model (runSkill).
 */
export const fastModel = 'claude-haiku-5-5'
