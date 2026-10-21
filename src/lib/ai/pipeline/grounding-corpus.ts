import { isRecent } from '~/lib/research/findings'
import type { Finding } from '~/lib/research/web-search'
import { isGenericPage, isReferencePage } from '~/lib/urls'
import { goalText, type GenerationContext } from '../context-blocks'
import type { KnowledgePassage } from '../embeddings'
import type { GroundingCorpus } from '../skills/ideation/guard'

type Claim = GroundingCorpus['verifiedClaims'][number]

/** Capitalised words that start a sentence rather than name a product. */
const NOT_A_PRODUCT_LINE = new Set([
  'the', 'and', 'for', 'with', 'our', 'your', 'their', 'its', 'from', 'into',
  'this', 'that', 'these', 'those', 'all', 'any', 'every', 'each', 'new', 'more'
])

/**
 * The account's own words: what it says about itself, its offerings and the
 * goals this run serves. Figures and product names stated here are the
 * account's, so the ideation guard accepts them as it accepts the evidence.
 * Goals that were not picked are left out, so their figures are not grounded.
 */
function accountTextOf(ctx: GenerationContext): string {
  const a = ctx.account
  return [
    a.name,
    a.company,
    a.bio,
    a.industry,
    ...ctx.offerings.flatMap(o => [
      o.name,
      o.tagline,
      o.description,
      o.whoItIsFor,
      o.problemSolved,
      ...(o.keyFeatures || []),
      ...(o.differentiators || []),
      ...(o.proofPoints || []).flatMap(p => [p.label, p.detail])
    ]),
    ...ctx.selectedGoals.map(goalText)
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Capitalised names in the account's name and offerings ("Galaxy", "QLED",
 * "Bespoke"): the product lines a model name invented for this brand would
 * start with.
 */
function productLinesOf(ctx: GenerationContext): string[] {
  const text = [
    ctx.account.name,
    ctx.account.company,
    ...ctx.offerings.flatMap(o => [
      o.name,
      o.tagline,
      o.description,
      ...(o.keyFeatures || [])
    ])
  ]
    .filter(Boolean)
    .join('\n')
  const words = text.match(/\b[A-Z][A-Za-z0-9]{2,}\b/g) || []
  return Array.from(new Set(words)).filter(
    w => !NOT_A_PRODUCT_LINE.has(w.toLowerCase())
  )
}

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


/**
 * What retrieval searches the knowledge base for: one query per goal the run
 * serves, so each goal finds the passages about it, and none for a goal that
 * was not picked. Without goals, the account's headline.
 */
export function buildRetrievalQueries(ctx: GenerationContext): string[] {
  const queries = ctx.selectedGoals.map(goalText).filter(Boolean)
  if (queries.length > 0) return queries
  return ctx.account.headline ? [ctx.account.headline] : []
}

export interface CorpusSources {
  offeringFacts: number
  knowledgePassages: number
  webFindings: number
  documentSummaries: number
  knowledgeClaims: number
}

/**
 * Everything a run's ideas may cite, with each kind of source represented early.
 *
 * Only a dated item from the last `freshness_days` is "fresh", and never a
 * homepage or news index. Every search result used to count as fresh, so an
 * idea could call anything news as long as the run had searched at all.
 */
export function buildGroundingCorpus(
  ctx: GenerationContext,
  findings: Finding[],
  passages: KnowledgePassage[] = [],
  now = new Date()
): GroundingCorpus & { sources: CorpusSources } {
  // Documents a goal's retrieval matched come first, closest first, so their
  // summaries and claims lead the slice the prompt shows; the rest keep their
  // order after them. Without retrieval, nothing moves.
  const closeness = new Map<string, number>()
  for (const p of passages) {
    closeness.set(p.documentId, Math.max(closeness.get(p.documentId) ?? 0, p.similarity))
  }
  const docs = [...ctx.knowledgeDocs].sort(
    (a, b) => (closeness.get(b.id) ?? -1) - (closeness.get(a.id) ?? -1)
  )
  const fresh = (url: string | undefined, publishedAt: string | undefined) =>
    !(url && (isGenericPage(url) || isReferencePage(url))) &&
    isRecent(publishedAt, ctx.prefs.research.freshness_days, now)
  const docDate = (doc: (typeof docs)[number]) =>
    doc.publishedAt ? doc.publishedAt.toISOString().slice(0, 10) : undefined

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
        sourceTitle: `${offering.name} — verified proof point`,
        origin: 'own'
      })
    }
    if (offering.description) {
      own.push({
        claim: offering.description,
        sourceTitle: `${offering.name} overview`,
        sourceUrl: offering.url || undefined,
        origin: 'own'
      })
    }
  }

  // Verbatim passages retrieved for this run's goals, so the quote is the passage.
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
      sourceId: doc.id,
      publishedAt: docDate(doc),
      isFresh: fresh(doc.sourceUrl || undefined, docDate(doc)),
      origin: 'knowledge'
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
      isFresh: fresh(f.url, f.publishedAt),
      origin: 'web'
    })
  }
  // Recent articles first and homepages last, so the slice the prompt shows
  // leads with what is new. The sort is stable within each group.
  const webRank = (c: Claim) =>
    c.isFresh ? 0 : c.sourceUrl && isGenericPage(c.sourceUrl) ? 2 : 1
  web.sort((a, b) => webRank(a) - webRank(b))

  // The summary grounds each document's overall thesis.
  const summaries: Claim[] = docs
    .filter(doc => doc.summary)
    .map(doc => ({
      claim: doc.summary!,
      sourceUrl: doc.sourceUrl || undefined,
      sourceTitle: doc.title,
      sourceId: doc.id,
      publishedAt: docDate(doc),
      isFresh: fresh(doc.sourceUrl || undefined, docDate(doc)),
      origin: 'knowledge' as const
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
          sourceId: doc.id,
          publishedAt: docDate(doc),
          isFresh: fresh(doc.sourceUrl || undefined, docDate(doc)),
          origin: 'knowledge' as const
        }))
    )
  )

  const verifiedClaims = interleave([own, retrieved, web, summaries, keyClaims])
  return {
    verifiedClaims,
    hasFreshEvidence: verifiedClaims.some(c => c.isFresh),
    accountText: accountTextOf(ctx),
    productLines: productLinesOf(ctx),
    sources: {
      offeringFacts: own.length,
      knowledgePassages: retrieved.length,
      webFindings: web.length,
      documentSummaries: summaries.length,
      knowledgeClaims: keyClaims.length
    }
  }
}
