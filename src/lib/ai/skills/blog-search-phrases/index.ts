import 'server-only'

import { runSkill } from '../../run-skill'
import type { CallUsage } from '../../usage'
import {
  buildSearchPhrasesPrompt,
  cleanSearchPhrases,
  SEARCH_PHRASES_INSTRUCTIONS
} from './prompt'
import { SearchPhrasesSchema } from './schema'

/** It runs beside research; a slow answer is not waited for. */
export const SEARCH_PHRASES_TIMEOUT_MS = 10_000

/**
 * Skill: a topic briefed without a keyword in, the 2-3 short phrases readers
 * would search for it out (the main one first). Throws SkillError when the
 * call fails; the caller then searches the topic's first words.
 */
export async function makeSearchPhrases(
  input: Parameters<typeof buildSearchPhrasesPrompt>[0],
  options: { timeoutMs?: number } = {}
): Promise<{ phrases: string[]; usage: CallUsage }> {
  const { output, usage } = await runSkill({
    stage: 'blog_search_phrases',
    instructions: SEARCH_PHRASES_INSTRUCTIONS,
    prompt: buildSearchPhrasesPrompt(input),
    schema: SearchPhrasesSchema,
    timeoutMs: options.timeoutMs ?? SEARCH_PHRASES_TIMEOUT_MS,
    maxRetries: 0
  })
  return { phrases: cleanSearchPhrases(output.phrases), usage }
}
