import type { CitationVerdict, VerificationIssueKind } from '@/lib/blogs/types'
import type { JudgeClaim } from './prompt'
import type { CitationJudgement } from './schema'

const collapse = (text: string | undefined | null) =>
  (text ?? '').replace(/\s+/g, ' ').trim()

/**
 * The check's answer kept to what can be trusted: verdicts only for claims
 * that were asked about (once each), and issues only for sentences that are
 * really in the article.
 */
export function cleanJudgement(
  raw: CitationJudgement,
  input: { claims: JudgeClaim[]; articleText: string }
): {
  verdicts: Array<{ id: string; verdict: CitationVerdict; reason: string }>
  issues: Array<{ sentence: string; issue: VerificationIssueKind; note: string }>
} {
  const known = new Set(input.claims.map(claim => claim.id))
  const seen = new Set<string>()
  const verdicts = (raw.verdicts ?? []).filter(v => {
    if (!known.has(v.id) || seen.has(v.id)) return false
    seen.add(v.id)
    return true
  }).map(v => ({ id: v.id, verdict: v.verdict, reason: collapse(v.reason).slice(0, 300) }))
  const article = collapse(input.articleText)
  const issues = (raw.issues ?? [])
    .map(issue => ({
      sentence: collapse(issue.sentence),
      issue: issue.issue,
      note: collapse(issue.note).slice(0, 300)
    }))
    .filter(issue => issue.sentence.length > 0 && article.includes(issue.sentence))
  return { verdicts, issues }
}
