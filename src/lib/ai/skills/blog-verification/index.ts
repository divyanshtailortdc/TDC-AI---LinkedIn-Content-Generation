import 'server-only'

import type { CitationVerdict, VerificationIssueKind } from '@/lib/blogs/types'
import { runSkill } from '../../run-skill'
import type { CallUsage } from '../../usage'
import { cleanJudgement } from './guard'
import { buildJudgePrompt, JUDGE_INSTRUCTIONS, type JudgeClaim } from './prompt'
import { CitationJudgementSchema } from './schema'

export type { JudgeClaim } from './prompt'

/** The check runs between writing and saving; it reads, it writes little. */
export const CITATION_CHECK_TIMEOUT_MS = 30_000

/**
 * Skill: each sentence that links a source, judged against that source's
 * passages (supported, partial, unsupported), and the piece read for facts
 * without a source and invented or sample details presented as real.
 * Throws SkillError when the call fails; the pipeline then keeps the
 * checks that need no model.
 */
export async function judgeCitations(
  input: { claims: JudgeClaim[]; articleText: string },
  options: { timeoutMs?: number } = {}
): Promise<{
  verdicts: Array<{ id: string; verdict: CitationVerdict; reason: string }>
  issues: Array<{ sentence: string; issue: VerificationIssueKind; note: string }>
  usage: CallUsage
  modelId: string
}> {
  const { output, usage, modelId } = await runSkill({
    stage: 'blog_verification',
    instructions: JUDGE_INSTRUCTIONS,
    prompt: buildJudgePrompt(input),
    schema: CitationJudgementSchema,
    timeoutMs: options.timeoutMs ?? CITATION_CHECK_TIMEOUT_MS,
    maxRetries: 1
  })
  return { ...cleanJudgement(output, input), usage, modelId }
}
