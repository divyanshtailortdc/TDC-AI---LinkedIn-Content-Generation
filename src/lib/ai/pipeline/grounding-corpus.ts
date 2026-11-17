import type { NewsletterStory } from '~/lib/intel/story-ranking'
import { isRecent } from '~/lib/research/findings'
import { ownHosts, rateSource } from '~/lib/research/source-credibility'
import type { Finding } from '~/lib/research/web-search'
import { isGenericPage, isReferencePage } from '~/lib/urls'
import { goalText, type GenerationContext } from '../context-blocks'
import { inferRegion } from '../region'
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
export function productLinesOf(ctx: GenerationContext): string[] {
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
  newsletterItems: number
  webFindings: number
  /** News, trends and conversations from the trend scan. */
  trendSignals: number
  documentSummaries: number
  knowledgeClaims: number
}

/** Findings the trend scan made, rather than research for a fact. */
const isSignal = (f: Finding) =>
  f.kind === 'news' || f.kind === 'trend' || f.kind === 'conversation'

/**
 * Whether a source can back news: dated within the account's freshness
 * window, and not a homepage, news index or reference page.
 */
export function isFreshSource(
  ctx: GenerationContext,
  url: string | null | undefined,
  publishedAt: string | null | undefined,
  now = new Date()
): boolean {
  return (
    !(url && (isGenericPage(url) || isReferencePage(url))) &&
    isRecent(publishedAt, ctx.prefs.research.freshness_days, now)
  )
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
  now = new Date(),
  stories: NewsletterStory[] = []
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
    isFreshSource(ctx, url, publishedAt, now)
  // Every source is rated for how far it can be trusted: the account's own
  // sites count as official, another market's pages count for less.
  const accountHosts = ownHosts([
    ctx.account.websiteUrl,
    ...ctx.offerings.map(o => o.url)
  ])
  const regionCode = inferRegion(ctx)?.code
  const rate = (
    url: string | undefined,
    origin: Claim['origin'],
    finding?: Finding
  ) =>
    rateSource({
      url,
      origin,
      ownHosts: accountHosts,
      regionCode,
      publisher: finding?.publisher,
      fromNewsSearch: finding?.provider === 'serper_news'
    })
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
        origin: 'own',
        credibility: rate(proof.sourceUrl || offering.url || undefined, 'own')
      })
    }
    if (offering.description) {
      own.push({
        claim: offering.description,
        sourceTitle: `${offering.name} overview`,
        sourceUrl: offering.url || undefined,
        origin: 'own',
        credibility: rate(offering.url || undefined, 'own')
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
      origin: 'knowledge',
      credibility: rate(doc.sourceUrl || undefined, 'knowledge')
    })
  }

  // Stories from the account's newsletters: the newsletter's own words, dated
  // when the email arrived, then what was read of the article, dated by the
  // article. Taken across stories in turn, so one cannot crowd out the rest.
  const day = (date: Date | null) => date?.toISOString().slice(0, 10)
  const newsletter = interleave(
    stories.map(story => {
      const source = {
        sourceUrl: story.url || undefined,
        origin: 'newsletter' as const,
        credibility: rate(story.url || undefined, 'newsletter')
      }
      const told = day(story.receivedAt)
      const items: Claim[] = [
        {
          ...source,
          claim: story.blurb || story.headline,
          quote: story.blurb || undefined,
          sourceTitle: `${story.headline} (in ${story.newsletter})`,
          publishedAt: told,
          isFresh: fresh(story.url || undefined, told)
        }
      ]
      if (story.article) {
        const dated = day(story.article.publishedAt) ?? told
        const article = {
          ...source,
          sourceTitle: story.article.title || story.headline,
          publishedAt: dated,
          isFresh: fresh(story.url || undefined, dated)
        }
        if (story.article.summary)
          items.push({ ...article, claim: story.article.summary })
        for (const c of story.article.claims.slice(0, 2)) {
          if (c.claim) items.push({ ...article, claim: c.claim, quote: c.quote })
        }
      }
      return items
    })
  )

  const asClaim = (f: Finding): Claim => ({
    claim: f.snippet || f.title,
    quote: f.snippet || undefined,
    sourceUrl: f.url,
    sourceTitle: f.title,
    publishedAt: f.publishedAt,
    isFresh: fresh(f.url, f.publishedAt),
    origin: 'web',
    credibility: rate(f.url, 'web', f),
    ...(f.kind && f.kind !== 'background' ? { kind: f.kind } : {}),
    ...(f.publisher ? { publisher: f.publisher } : {})
  })
  const usable = findings.filter(f => f.snippet || f.title)

  const web: Claim[] = usable.filter(f => !isSignal(f)).map(asClaim)
  // Recent articles first and homepages last, so the slice the prompt shows
  // leads with what is new; within each, the most trustworthy first.
  const webRank = (c: Claim) =>
    c.isFresh ? 0 : c.sourceUrl && isGenericPage(c.sourceUrl) ? 2 : 1
  web.sort(
    (a, b) =>
      webRank(a) - webRank(b) ||
      (b.credibility?.score ?? 0) - (a.credibility?.score ?? 0)
  )

  // What is happening now: the news, trends and conversations, taken in
  // turn so each kind is shown, this week's first within each.
  const byKind = (kind: Claim['kind']) =>
    usable
      .filter(f => f.kind === kind)
      .map(asClaim)
      .sort((a, b) => Number(!!b.isFresh) - Number(!!a.isFresh))
  const trends = interleave([byKind('news'), byKind('trend'), byKind('conversation')])

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
      origin: 'knowledge' as const,
      credibility: rate(doc.sourceUrl || undefined, 'knowledge')
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
          origin: 'knowledge' as const,
          credibility: rate(doc.sourceUrl || undefined, 'knowledge')
        }))
    )
  )

  const verifiedClaims = interleave([
    own,
    retrieved,
    newsletter,
    trends,
    web,
    summaries,
    keyClaims
  ])
  return {
    verifiedClaims,
    hasFreshEvidence: verifiedClaims.some(c => c.isFresh),
    accountText: accountTextOf(ctx),
    productLines: productLinesOf(ctx),
    sources: {
      offeringFacts: own.length,
      knowledgePassages: retrieved.length,
      newsletterItems: newsletter.length,
      webFindings: web.length,
      trendSignals: trends.length,
      documentSummaries: summaries.length,
      knowledgeClaims: keyClaims.length
    }
  }
}
