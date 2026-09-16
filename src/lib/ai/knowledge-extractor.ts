import { generateText, Output } from 'ai'
import { z } from 'zod'
import { getLanguageModel } from '~/lib/ai'

export type KeyClaim = {
  claim: string
  quote: string
  confidence?: number
}

export type KnowledgeExtractionResult = {
  summary: string
  topics: string[]
  claims: KeyClaim[]
}

const ExtractionSchema = z.object({
  summary: z
    .string()
    .describe("A concise 2-sentence summary of the document's core thesis."),
  topics: z
    .array(z.string())
    .max(6)
    .default([])
    .describe('2 to 6 short topic tags describing what this document covers.'),
  claims: z
    .array(
      z.object({
        claim: z
          .string()
          .describe('A clear, single-sentence statement of the claim.'),
        quote: z
          .string()
          .describe(
            'An exact, verbatim span copied from the document that supports the claim. Never paraphrase here.'
          ),
        confidence: z.number().min(0).max(1).default(0.9)
      })
    )
    .default([])
    .describe('3 to 7 key claims, each with its verbatim supporting quote.')
})

/**
 * A quote only grounds a claim if it genuinely appears in the source, so quotes
 * the model paraphrased are dropped rather than trusted.
 */
function keepVerifiableClaims(
  claims: KeyClaim[],
  content: string
): KeyClaim[] {
  const haystack = content.toLowerCase().replace(/\s+/g, ' ')
  return claims.filter(c => {
    const quote = (c.quote || '').toLowerCase().replace(/\s+/g, ' ').trim()
    if (quote.length < 15) return false
    return haystack.includes(quote)
  })
}

export async function extractKnowledgeClaims(
  title: string,
  content: string
): Promise<KnowledgeExtractionResult> {
  const truncatedContent = content.slice(0, 15000)
  const handle = getLanguageModel('extraction')

  if (handle) {
    try {
      const { output } = await generateText({
        model: handle.model,
        providerOptions: handle.providerOptions,
        instructions:
          'You extract verified factual claims with verbatim supporting quotes for a knowledge base. Every quote must be copied character-for-character from the source document.',
        prompt: `Analyze this document.

Title: ${title}

Content:
${truncatedContent}`,
        output: Output.object({ schema: ExtractionSchema })
      })

      if (output?.summary) {
        const verified = keepVerifiableClaims(output.claims || [], content)
        return {
          summary: output.summary,
          topics: output.topics || [],
          claims: verified
        }
      }
    } catch (err) {
      console.warn(
        'Knowledge extraction model call failed, using heuristic:',
        err
      )
    }
  }

  // Heuristic fallback: real sentences from the document, so quotes stay verbatim.
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
