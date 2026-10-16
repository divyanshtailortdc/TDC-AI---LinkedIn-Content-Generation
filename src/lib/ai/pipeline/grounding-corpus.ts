import type { Finding } from '~/lib/research/web-search'
import type { GenerationContext } from '../context-blocks'
import type { KnowledgePassage } from '../embeddings'
import type { GroundingCorpus } from '../skills/ideation/guard'

type Claim = GroundingCorpus['verifiedClaims'][number]

/**
 * One item from each list in turn until every list is used up.
 *
 * The ideation prompt shows only the first PROMPT_EVIDENCE_LIMIT items. Built
 * one source after another, an account with a few long documents filled that
 * slice with their claims, and the account's own offerings, the passages
 * retrieved for this goal and every fresh web finding were never shown.
 */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = []
  const longest = Math.max(0, ...lists.map(l => l.length))
  for (let i = 0; i < longest; i++) {
    for (const items of lists) if (i < items.length) out.push(items[i]!)
  }
  return out
}


export interface CorpusSources {
  offeringFacts: number
  knowledgePassages: number
  webFindings: number
  documentSummaries: number
  knowledgeClaims: number
}

/** Everything a run's ideas may cite, with each kind of source represented early. */
export function buildGroundingCorpus(
  ctx: GenerationContext,
  findings: Finding[],
  passages: KnowledgePassage[] = []
): GroundingCorpus & { sources: CorpusSources } {
  const docs = ctx.knowledgeDocs

  // The account's own verified numbers and offerings: the defense against
  // invented metrics, and the most specific thing known about this business.
  const own: Claim[] = []
  for (const offering of ctx.offerings) {
    for (const proof of offering.proofPoints || []) {
      if (!proof.label) continue
      own.push({
        claim: proof.detail ? `${proof.label}: ${proof.detail}` : proof.label,
        quote: proof.detail || proof.label,
        sourceUrl: proof.sourceUrl || offering.url || undefined,
        sourceTitle: `${offering.name} — verified proof point`
      })
    }
    if (offering.description) {
      own.push({
        claim: offering.description,
        sourceTitle: `${offering.name} overview`,
        sourceUrl: offering.url || undefined
      })
    }
  }

  // Verbatim passages retrieved for this goal, so the quote is the passage.
  const docsById = new Map(docs.map(d => [d.id, d]))
  const retrieved: Claim[] = []
  for (const passage of passages) {
    const doc = docsById.get(passage.documentId)
    if (!doc) continue
    retrieved.push({
      claim: passage.content,
      quote: passage.content,
      sourceUrl: doc.sourceUrl || undefined,
      sourceTitle: doc.title,
      sourceId: doc.id
    })
  }

  const web: Claim[] = []
  for (const f of findings) {
    if (!f.snippet && !f.title) continue
    web.push({
      claim: f.snippet || f.title,
      quote: f.snippet || undefined,
      sourceUrl: f.url,
      sourceTitle: f.title,
      publishedAt: f.publishedAt,
      isFresh: f.provider === 'serper_search'
    })
  }

  // The summary grounds each document's overall thesis.
  const summaries: Claim[] = docs
    .filter(doc => doc.summary)
    .map(doc => ({
      claim: doc.summary!,
      sourceUrl: doc.sourceUrl || undefined,
      sourceTitle: doc.title,
      sourceId: doc.id
    }))

  // Taken across documents in turn, so one long document cannot crowd out the rest.
  const keyClaims = interleave(
    docs.map(doc =>
      (doc.keyClaims || [])
        .filter(c => c.claim)
        .map(c => ({
          claim: c.claim,
          quote: c.quote,
          sourceUrl: doc.sourceUrl || undefined,
          sourceTitle: doc.title,
          sourceId: doc.id
        }))
    )
  )

  return {
    verifiedClaims: interleave([own, retrieved, web, summaries, keyClaims]),
    hasFreshEvidence: findings.some(f => f.provider === 'serper_search'),
    sources: {
      offeringFacts: own.length,
      knowledgePassages: retrieved.length,
      webFindings: web.length,
      documentSummaries: summaries.length,
      knowledgeClaims: keyClaims.length
    }
  }
}
