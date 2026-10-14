import { sanitizeVoiceAnalysis } from './guard'
import type { VoiceAnalysisResult } from './schema'

/**
 * Heuristic linguistic analyzer used as an offline baseline when no AI key is configured.
 */
export function analyzeHeuristically(text: string): VoiceAnalysisResult {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0)
  const lines = text.split(/\n+/).filter(l => l.trim().length > 0)

  // Perspective
  const iCount = (text.match(/\b(I|me|my|mine)\b/gi) || []).length
  const weCount = (text.match(/\b(we|us|our|ours)\b/gi) || []).length
  const perspective = iCount >= weCount ? 'I' : 'we'

  // Emojis
  const emojiCount = (
    text.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu) || []
  ).length
  let emojiPolicy: 'none' | 'bullets only' | 'liberal' = 'none'
  if (emojiCount > 8) emojiPolicy = 'liberal'
  else if (emojiCount > 0) emojiPolicy = 'bullets only'

  // Hashtags
  const hashtagCount = (text.match(/#[a-z0-9_]+/gi) || []).length
  const hashtagPolicy =
    hashtagCount === 0
      ? 'none'
      : hashtagCount <= 3
        ? '0-3, end of post'
        : '3-5, end of post'

  // Formality & Directness
  const avgSentenceLength = words.length / Math.max(1, sentences.length)
  const formality = avgSentenceLength > 18 ? 4 : avgSentenceLength < 10 ? 2 : 3
  const directness = lines.length > 5 ? 4 : 3

  // Writing patterns and signature phrases actually found, for the rubric
  const writingPatterns: string[] = []
  if (/you do not need|you don't need/i.test(text)) {
    writingPatterns.push("You don't need X. You need Y.")
  }
  if (/is not the|isn't the.*is/i.test(text)) {
    writingPatterns.push("X isn't the problem. Y is.")
  }
  if (/blame creates|creates/i.test(text)) {
    writingPatterns.push('A creates B. C creates D.')
  }

  const signaturePhrases: string[] = []
  if (/net revenue retention/i.test(text))
    signaturePhrases.push('Net revenue retention')
  if (/before making/i.test(text))
    signaturePhrases.push('before making a single dollar')
  if (/uncomfortable truth/i.test(text))
    signaturePhrases.push('Here is an uncomfortable truth:')

  const quote = (items: string[]) => items.map(i => `"${i}"`).join(', ')
  const derivedStyleRubric = [
    'Opens with a concrete scene or number, never an unearned claim. Short paragraphs with one idea each, using staccato rhythm and high whitespace. Closes on a philosophical question or practical takeaway, never hard engagement bait. Avoids corporate buzzwords like "delve", "leverage", and "game-changer".',
    writingPatterns.length > 0 &&
      `Uses contrast patterns such as ${quote(writingPatterns)}.`,
    signaturePhrases.length > 0 &&
      `Signature phrases to reuse sparingly: ${quote(signaturePhrases)}.`
  ]
    .filter(Boolean)
    .join(' ')

  const rawResult: VoiceAnalysisResult = {
    derivedStyleRubric,
    tone: 'candid',
    formality,
    directness,
    perspective,
    emojiPolicy,
    hashtagPolicy
  }

  return sanitizeVoiceAnalysis(rawResult)
}
