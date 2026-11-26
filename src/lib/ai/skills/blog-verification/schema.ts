import { CITATION_VERDICTS } from '@/lib/blogs/types'
import { z } from 'zod'

/** The model-checkable problems; figure checks are done without a model. */
export const JUDGED_ISSUES = [
  'fact_without_source',
  'hypothetical_as_fact',
  'sample_data_as_real',
  'opinion_as_fact',
  'generic_passage',
  'repeats_earlier_point',
  'research_narration'
] as const

/** What the citation check returns: a verdict per claim, and issues found reading the piece. */
export const CitationJudgementSchema = z.object({
  verdicts: z.array(
    z.object({
      id: z.string().describe('The claim id, e.g. C1'),
      verdict: z.enum(CITATION_VERDICTS),
      reason: z.string().describe('What matches or differs, in one sentence')
    })
  ),
  issues: z
    .array(
      z.object({
        sentence: z.string().describe('The sentence, copied exactly from the article'),
        issue: z.enum(JUDGED_ISSUES),
        note: z.string().describe('What is wrong, in one sentence')
      })
    )
    .describe('Only clear cases; empty when there are none')
})

export type CitationJudgement = z.infer<typeof CitationJudgementSchema>
