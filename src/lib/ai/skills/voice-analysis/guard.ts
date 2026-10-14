import type { VoiceAnalysisResult } from './schema'

/** Cleans Claude's voice analysis: trims the rubric and clamps the scales to 1..5. */
export function sanitizeVoiceAnalysis(
  raw: VoiceAnalysisResult
): VoiceAnalysisResult {
  // Clamp numeric scores to 1..5
  const formality = Math.min(5, Math.max(1, Math.round(raw.formality || 3)))
  const directness = Math.min(5, Math.max(1, Math.round(raw.directness || 4)))

  return {
    ...raw,
    derivedStyleRubric: raw.derivedStyleRubric.trim(),
    formality,
    directness
  }
}
