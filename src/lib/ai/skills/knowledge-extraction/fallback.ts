import type { KnowledgeExtractionResult } from './schema'

/**
 * Used when no model is configured or the call fails: real sentences from the
 * document, so quotes stay verbatim.
 */
export function extractHeuristically(
  title: string,
  content: string
): KnowledgeExtractionResult {
  const sentences = content
    .split(/(?<=[.?!])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 25 && s.length < 350)

  const metricSentences = sentences.filter(s =>
    /(\d+%|\$\d+|\b(increased|decreased|reduced|achieved|doubled|tripled|grew|million|billion|faster|roi)\b)/i.test(
      s
    )
  )

  const selectedQuotes = (
    metricSentences.length >= 3 ? metricSentences : sentences
  ).slice(0, 5)

  return {
    summary:
      sentences.slice(0, 2).join(' ') ||
      `${title}: source material awaiting summarization.`,
    topics: [],
    claims: selectedQuotes.map(quote => ({
      claim: quote.length > 90 ? `${quote.slice(0, 87)}...` : quote,
      quote,
      confidence: 0.6
    }))
  }
}
