import { z } from 'zod'

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

export const ExtractionSchema = z.object({
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
