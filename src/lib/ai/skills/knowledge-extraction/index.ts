import 'server-only'

import { isBusyError, runSkill } from '../../run-skill'
import { extractHeuristically } from './fallback'
import { keepVerifiableClaims } from './guard'
import { buildPrompt, INSTRUCTIONS } from './prompt'
import { ExtractionSchema, type KnowledgeExtractionResult } from './schema'

export type { KeyClaim, KnowledgeExtractionResult } from './schema'

/**
 * Skill: a knowledge document in, a summary and quotable claims out. When
 * the model fails, a heuristic summary instead, except with `throwWhenBusy`
 * for a failure that may pass (timed out, out of budget, rate-limited,
 * down): the error is thrown, for a caller that can try again later
 * (read-article.ts).
 */
export async function extractKnowledgeClaims(
  title: string,
  content: string,
  options: { timeoutMs?: number; throwWhenBusy?: boolean } = {}
): Promise<KnowledgeExtractionResult> {
  try {
    const { output } = await runSkill({
      stage: 'extraction',
      instructions: INSTRUCTIONS,
      prompt: buildPrompt({ title, content }),
      schema: ExtractionSchema,
      timeoutMs: options.timeoutMs
    })

    if (output?.summary) {
      return {
        summary: output.summary,
        topics: output.topics || [],
        claims: keepVerifiableClaims(output.claims || [], content)
      }
    }
  } catch (err) {
    if (options.throwWhenBusy && isBusyError(err)) throw err
    console.warn(
      'Knowledge extraction model call failed, using heuristic:',
      err
    )
  }

  return extractHeuristically(title, content)
}
