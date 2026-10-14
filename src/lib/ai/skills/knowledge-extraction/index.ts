import 'server-only'

import { runSkill } from '../../run-skill'
import { extractHeuristically } from './fallback'
import { keepVerifiableClaims } from './guard'
import { buildPrompt, INSTRUCTIONS } from './prompt'
import { ExtractionSchema, type KnowledgeExtractionResult } from './schema'

export type { KeyClaim, KnowledgeExtractionResult } from './schema'

/** Skill: a knowledge document in, a summary and quotable claims out. */
export async function extractKnowledgeClaims(
  title: string,
  content: string
): Promise<KnowledgeExtractionResult> {
  try {
    const { output } = await runSkill({
      stage: 'extraction',
      instructions: INSTRUCTIONS,
      prompt: buildPrompt({ title, content }),
      schema: ExtractionSchema
    })

    if (output?.summary) {
      return {
        summary: output.summary,
        topics: output.topics || [],
        claims: keepVerifiableClaims(output.claims || [], content)
      }
    }
  } catch (err) {
    console.warn(
      'Knowledge extraction model call failed, using heuristic:',
      err
    )
  }

  return extractHeuristically(title, content)
}
