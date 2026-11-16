import 'server-only'

import {
  cleanProfileInsights,
  type ProfileInsights
} from '@/lib/profile-insights/types'
import { runSkill } from '../../run-skill'
import { buildPrompt, INSTRUCTIONS } from './prompt'
import { ProfileAnalysisSchema, type AnalyzeProfileInput } from './schema'

export type * from './schema'

/** An analysis still running after this is given up; the user can try again. */
const ANALYSIS_TIMEOUT_MS = 150_000

/**
 * Skill: an account's posts on one platform (and a few of their images) in,
 * what they show about how it posts there out. Throws SkillError when the
 * model cannot be reached; an answer with nothing usable in it throws too.
 */
export async function analyzeProfilePosts(input: AnalyzeProfileInput): Promise<{
  insights: ProfileInsights
  modelUsed: string
}> {
  const result = await runSkill({
    stage: 'profile_analysis',
    instructions: INSTRUCTIONS,
    prompt: buildPrompt(input),
    images: input.images,
    schema: ProfileAnalysisSchema,
    timeoutMs: ANALYSIS_TIMEOUT_MS,
    maxRetries: 1,
    abortSignal: input.abortSignal
  })
  const insights = cleanProfileInsights(result.output)
  if (!insights) throw new Error('The analysis came back empty.')
  return { insights, modelUsed: `${result.providerName} (${result.modelId})` }
}
