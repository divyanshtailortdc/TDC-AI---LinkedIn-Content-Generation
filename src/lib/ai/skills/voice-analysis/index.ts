import 'server-only'

import { runSkill } from '../../run-skill'
import { analyzeHeuristically } from './fallback'
import { sanitizeVoiceAnalysis } from './guard'
import { buildPrompt, INSTRUCTIONS } from './prompt'
import { VoiceAnalysisSchema, type VoiceAnalysisResult } from './schema'

/** Skill: real sample posts in, a voice profile (rubric and settings) out. */
export async function analyzeVoiceSamples(samplesText: string): Promise<{
  result: VoiceAnalysisResult
  provider: 'claude' | 'heuristic'
  modelUsed?: string
}> {
  const cleanText = samplesText.trim()
  if (!cleanText) {
    throw new Error('Please paste at least one sample post to analyze.')
  }

  try {
    const { output, modelId, providerName } = await runSkill({
      stage: 'voice_analysis',
      instructions: INSTRUCTIONS,
      prompt: buildPrompt(cleanText),
      schema: VoiceAnalysisSchema
    })
    return {
      result: sanitizeVoiceAnalysis(output),
      provider: 'claude',
      modelUsed: `${providerName} (${modelId})`
    }
  } catch (error) {
    // No key configured, or the call failed: the offline analyzer still gives
    // the user something to edit.
    console.warn('Voice analysis model call failed, using heuristic:', error)
    return { result: analyzeHeuristically(cleanText), provider: 'heuristic' }
  }
}
