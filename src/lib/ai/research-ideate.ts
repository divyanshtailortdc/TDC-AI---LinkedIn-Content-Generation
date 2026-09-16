import { db } from '@/db'
import {
  ideasTable,
  postDraftsTable,
  researchFindingsTable,
  runStepsTable,
  runsTable
} from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { generateText, Output } from 'ai'
import { env } from '~/env'
import {
  estimateCostUsd,
  getLanguageModel,
  readUsage,
  type StageUsage
} from '~/lib/ai'
import {
  loadGenerationContext,
  pickWeightedPillars,
  renderAudienceBlock,
  renderGoalBlock,
  renderGuardrailsBlock,
  renderIdentityBlock,
  renderVoiceBlock,
  type GenerationContext
} from './context'
import {
  IdeasGenerationSchema,
  PERSPECTIVE_ANGLE_GUIDE,
  type GeneratedIdeaItem
} from './schemas'
import { validateIdea, type GroundingCorpus } from './idea-validator'
import { filterDiverseIdeas } from './idea-diversity'
import { checkNovelty } from '~/lib/novelty'

export interface ResearchIdeateResult {
  ideasCount: number
  findingsCount: number
  runId: string
  status: string
}

type Finding = {
  url: string
  title: string
  snippet: string
  provider: string
  publishedAt?: string
}

/** Serper's freshness operator, derived from the configured window. */
function freshnessToTbs(days: number): string | undefined {
  if (!days || days <= 0) return undefined
  if (days <= 1) return 'qdr:d'
  if (days <= 7) return 'qdr:w'
  if (days <= 31) return 'qdr:m'
  if (days <= 366) return 'qdr:y'
  return undefined
}

/** Applies the account's domain policy as search operators. */
function applyDomainPolicy(
  query: string,
  policy: GenerationContext['prefs']['research']
): string {
  if (policy.domain_mode === 'allowed' && policy.allowed_domains?.length) {
    const sites = policy.allowed_domains.map(d => `site:${d}`).join(' OR ')
    return `${query} (${sites})`
  }
  if (policy.domain_mode === 'blocked' && policy.blocked_domains?.length) {
    const excluded = policy.blocked_domains.map(d => `-site:${d}`).join(' ')
    return `${query} ${excluded}`
  }
  return query
}

/**
 * Search queries come from what the account is actually trying to say, not a
 * fixed template. Previously every run searched
 * "<goal title> industry trends insights 2026".
 */
function buildSearchQueries(
  ctx: GenerationContext,
  limit: number
): string[] {
  const queries: string[] = []
  const goal = ctx.primaryGoal

  if (goal?.keyMessage) queries.push(goal.keyMessage)
  if (goal?.title) queries.push(goal.title)

  for (const pillar of ctx.prefs.pillars) {
    if (queries.length >= limit + 2) break
    const topics = pillar.example_topics || []
    queries.push(topics.length > 0 ? `${pillar.name} ${topics[0]}` : pillar.name)
  }

  for (const audience of ctx.audiences) {
    if (queries.length >= limit + 2) break
    const pain = (audience.painPoints || [])[0]
    if (pain) queries.push(pain)
  }

  if (queries.length === 0) {
    queries.push(ctx.account.headline || ctx.account.name)
  }

  return Array.from(new Set(queries.map(q => q.trim()).filter(Boolean))).slice(
    0,
    limit
  )
}

async function runWebSearch(
  ctx: GenerationContext,
  onQuery: (q: string) => void
): Promise<Finding[]> {
  const policy = ctx.prefs.research
  if (!policy.use_web_search) return []
  if (policy.provider !== 'serper') return []
  if (!env.SERPER_API_KEY) return []

  const maxSearches = Math.max(1, Math.min(policy.max_searches_per_run || 3, 8))
  const queries = buildSearchQueries(ctx, maxSearches)
  const tbs = freshnessToTbs(policy.freshness_days)
  const findings: Finding[] = []

  for (const query of queries) {
    const finalQuery = applyDomainPolicy(query, policy)
    onQuery(finalQuery)
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': env.SERPER_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q: finalQuery, num: 5, ...(tbs ? { tbs } : {}) })
      })
      if (!res.ok) {
        console.warn(`Serper search failed (${res.status}) for "${finalQuery}"`)
        continue
      }
      const data = await res.json()
      for (const item of data.organic || []) {
        if (!item.link || !item.title) continue
        findings.push({
          url: item.link,
          title: item.title,
          snippet: item.snippet || '',
          provider: 'serper_search',
          publishedAt: item.date
        })
      }
    } catch (err) {
      console.warn(`Serper search error for "${finalQuery}":`, err)
    }
  }

  // Same URL can surface across queries.
  const seen = new Set<string>()
  return findings.filter(f => {
    if (seen.has(f.url)) return false
    seen.add(f.url)
    return true
  })
}

/**
 * Builds the corpus every claim is checked against: key claims with verbatim
 * quotes from the knowledge base, web findings, and the account's own proof
 * points. Nothing invented — an earlier version seeded a fake "62% latency
 * reduction" benchmark when no real evidence existed.
 */
function buildGroundingCorpus(
  ctx: GenerationContext,
  findings: Finding[]
): GroundingCorpus {
  const verifiedClaims: GroundingCorpus['verifiedClaims'] = []
  const policy = ctx.prefs.research

  if (policy.use_knowledge_base) {
    const allowed = policy.source_ids || []
    const docs =
      allowed.length > 0
        ? ctx.knowledgeDocs.filter(d => allowed.includes(d.id))
        : ctx.knowledgeDocs

    for (const doc of docs) {
      for (const claim of doc.keyClaims || []) {
        if (!claim.claim) continue
        verifiedClaims.push({
          claim: claim.claim,
          quote: claim.quote,
          sourceUrl: doc.sourceUrl || undefined,
          sourceTitle: doc.title,
          sourceId: doc.id
        })
      }
      // The summary grounds the document's overall thesis.
      if (doc.summary) {
        verifiedClaims.push({
          claim: doc.summary,
          sourceUrl: doc.sourceUrl || undefined,
          sourceTitle: doc.title,
          sourceId: doc.id
        })
      }
    }
  }

  for (const f of findings) {
    if (!f.snippet && !f.title) continue
    verifiedClaims.push({
      claim: f.snippet || f.title,
      quote: f.snippet || undefined,
      sourceUrl: f.url,
      sourceTitle: f.title,
      publishedAt: f.publishedAt,
      isFresh: f.provider === 'serper_search'
    })
  }

  // The account's own verified numbers — the defense against invented metrics.
  for (const offering of ctx.offerings) {
    for (const proof of offering.proofPoints || []) {
      if (!proof.label) continue
      verifiedClaims.push({
        claim: proof.detail ? `${proof.label}: ${proof.detail}` : proof.label,
        quote: proof.detail || proof.label,
        sourceUrl: proof.sourceUrl || offering.url || undefined,
        sourceTitle: `${offering.name} — verified proof point`
      })
    }
    if (offering.description) {
      verifiedClaims.push({
        claim: offering.description,
        sourceTitle: `${offering.name} overview`,
        sourceUrl: offering.url || undefined
      })
    }
  }

  return {
    verifiedClaims,
    hasFreshEvidence: findings.some(f => f.provider === 'serper_search')
  }
}

function renderCorpusForPrompt(
  corpus: GroundingCorpus,
  limit: number
): string {
  if (corpus.verifiedClaims.length === 0) {
    return 'No evidence was gathered for this run. Do NOT state any statistic, metric or named example. Build ideas from reasoning the author can defend from their own stated expertise.'
  }
  return corpus.verifiedClaims
    .slice(0, limit)
    .map((c, i) => {
      const parts = [`[E${i + 1}] ${c.claim}`]
      if (c.quote && c.quote !== c.claim) parts.push(`    Quote: "${c.quote}"`)
      if (c.sourceTitle) parts.push(`    Source: ${c.sourceTitle}`)
      if (c.sourceUrl) parts.push(`    URL: ${c.sourceUrl}`)
      return parts.join('\n')
    })
    .join('\n')
}

export async function executeResearchAndIdeate(
  runId: string
): Promise<ResearchIdeateResult> {
  const run = await db.query.runsTable.findFirst({
    where: eq(runsTable.id, runId)
  })
  if (!run) throw new Error(`Run ${runId} not found`)

  const ctx = await loadGenerationContext(run.accountId, { goalId: run.goalId })

  // The run froze its research config at enqueue time so the run stays
  // explainable weeks later, even after preferences change.
  const snapshot = run.researchConfig as Partial<
    GenerationContext['prefs']['research']
  > | null
  if (snapshot && Object.keys(snapshot).length > 0) {
    ctx.prefs.research = { ...ctx.prefs.research, ...snapshot }
  }

  const usageTotals: StageUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0
  }
  let costUsd = 0

  // ---------------------------------------------------------------- context
  const contextStart = Date.now()
  const [contextStep] = await db
    .insert(runStepsTable)
    .values({
      runId,
      stage: 'gathering_context',
      status: 'running',
      startedAt: new Date(),
      requestSummary:
        'Consolidating identity, offerings, audiences, knowledge base and goals'
    })
    .returning()

  const targetIdeas = Math.max(
    3,
    Math.min(ctx.prefs.cadence.ideas_per_run || 5, 12)
  )

  if (contextStep) {
    await db
      .update(runStepsTable)
      .set({
        status: 'completed',
        completedAt: new Date(),
        durationMs: Date.now() - contextStart,
        responseJson: {
          account: ctx.account.name,
          offerings: ctx.offerings.length,
          audiences: ctx.audiences.length,
          knowledgeDocs: ctx.knowledgeDocs.length,
          activeGoals: ctx.activeGoals.length,
          primaryGoal: ctx.primaryGoal?.title ?? null,
          pillars: ctx.prefs.pillars.map(p => p.name),
          targetIdeas
        }
      })
      .where(eq(runStepsTable.id, contextStep.id))
  }

  // --------------------------------------------------------------- research
  const researchStart = Date.now()
  const searchedQueries: string[] = []
  const [researchStep] = await db
    .insert(runStepsTable)
    .values({
      runId,
      stage: 'researching',
      status: 'running',
      startedAt: new Date(),
      requestSummary: ctx.prefs.research.use_web_search
        ? 'Searching the web and reading the knowledge base'
        : 'Reading the knowledge base (web search disabled in preferences)'
    })
    .returning()

  await db
    .update(runsTable)
    .set({ status: 'researching' })
    .where(eq(runsTable.id, runId))

  const findings = await runWebSearch(ctx, q => searchedQueries.push(q))

  for (const f of findings) {
    await db.insert(researchFindingsTable).values({
      runId,
      url: f.url,
      title: f.title,
      snippet: f.snippet,
      publishedAt: f.publishedAt ?? null,
      provider: f.provider
    })
  }

  const corpus = buildGroundingCorpus(ctx, findings)

  if (researchStep) {
    await db
      .update(runStepsTable)
      .set({
        status: 'completed',
        completedAt: new Date(),
        durationMs: Date.now() - researchStart,
        responseJson: {
          queries: searchedQueries,
          webFindings: findings.length,
          knowledgeClaims: corpus.verifiedClaims.length - findings.length,
          totalEvidence: corpus.verifiedClaims.length
        }
      })
      .where(eq(runStepsTable.id, researchStep.id))
  }

  // --------------------------------------------------------------- ideation
  const ideationStart = Date.now()
  const [ideationStep] = await db
    .insert(runStepsTable)
    .values({
      runId,
      stage: 'generating_ideas',
      status: 'running',
      startedAt: new Date(),
      requestSummary: `Generating and grounding ${targetIdeas} candidate ideas`
    })
    .returning()

  await db
    .update(runsTable)
    .set({ status: 'ideating' })
    .where(eq(runsTable.id, runId))

  const handle = getLanguageModel('ideation')
  if (!handle) {
    const message =
      'No AI provider configured. Add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to generate ideas.'
    if (ideationStep) {
      await db
        .update(runStepsTable)
        .set({ status: 'failed', completedAt: new Date(), error: message })
        .where(eq(runStepsTable.id, ideationStep.id))
    }
    await db
      .update(runsTable)
      .set({ status: 'failed', error: message })
      .where(eq(runsTable.id, runId))
    throw new Error(message)
  }

  // Over-generate so grounding and diversity filters have something to cut.
  const candidateCount = Math.min(targetIdeas + 3, 15)
  const assignedPillars = pickWeightedPillars(ctx.prefs.pillars, candidateCount)

  // Recent posts, so "fresh angle" means fresh for this account.
  const recentDrafts = await db
    .select({
      hook: postDraftsTable.hook,
      body: postDraftsTable.body
    })
    .from(postDraftsTable)
    .where(eq(postDraftsTable.accountId, ctx.account.id))
    .orderBy(desc(postDraftsTable.createdAt))
    .limit(30)

  const anglesList = Object.entries(PERSPECTIVE_ANGLE_GUIDE)
    .map(([angle, guide]) => `- ${angle}: ${guide}`)
    .join('\n')

  const pillarBrief =
    ctx.prefs.pillars.length > 0
      ? ctx.prefs.pillars
          .map(
            p =>
              `- ${p.name} (${p.weight_pct}% of output)${p.description ? `: ${p.description}` : ''}${
                (p.example_topics || []).length > 0
                  ? `\n    Example topics: ${(p.example_topics || []).join(', ')}`
                  : ''
              }`
          )
          .join('\n')
      : 'No pillars configured — infer sensible themes from the identity and goal.'

  const formatBrief =
    ctx.prefs.formats.length > 0
      ? ctx.prefs.formats.map(f => `${f.format} (${f.weight}%)`).join(', ')
      : 'no format preference set'

  const guardrails = renderGuardrailsBlock(ctx)
  const recentHooks = recentDrafts
    .slice(0, 12)
    .map(d => `- ${d.hook}`)
    .join('\n')

  const systemPrompt = `You are a senior editorial strategist who plans LinkedIn content for one specific person or company.

Everything you propose must be true of THIS account and defensible from THIS evidence. You are not writing generic B2B advice, and you have no knowledge of this business beyond what appears below.

WHO YOU ARE WRITING FOR
${renderIdentityBlock(ctx)}

WHO IS READING
${renderAudienceBlock(ctx, ctx.primaryGoal)}

THE GOAL THIS RUN SERVES
${renderGoalBlock(ctx.primaryGoal)}

HOW THIS AUTHOR SOUNDS
${renderVoiceBlock(ctx)}

CONTENT PILLARS
${pillarBrief}

PREFERRED FORMATS: ${formatBrief}
${guardrails ? `\nGUARDRAILS\n${guardrails}` : ''}

RULES THAT OVERRIDE EVERYTHING ELSE
1. Never state a statistic, metric, dollar figure or named customer unless it appears verbatim in the evidence below. If you have no number, make the point without one.
2. Never invent first-hand experience. Do not write "we discovered", "I spoke to a customer", "last week we saw". You do not know what this person did.
3. Only claim something is timely if the evidence carries a recent date. Otherwise argue from structure, not from news.
4. Do not pitch the account's product. These are ideas that stand on their own; the offering is context for credibility, not the conclusion.
5. Qualify honestly. Prefer "often", "in most teams" over "always", "every", "proves that".`

  const userPrompt = `EVIDENCE AVAILABLE THIS RUN
${renderCorpusForPrompt(corpus, 30)}

${
  recentHooks
    ? `ALREADY PUBLISHED BY THIS ACCOUNT — do not repeat these angles:\n${recentHooks}\n`
    : ''
}
ANALYTICAL LENSES — give each idea a different one:
${anglesList}

Produce exactly ${candidateCount} distinct post ideas.

Assign pillars in this distribution (one per idea, in order): ${assignedPillars
    .map(p => p.name)
    .join(' | ') || 'your own judgement'}

For each idea provide:
- title: a specific, non-generic working title
- thesis: the defensible proposition in one or two sentences
- perspectiveAngle: the lens from the list above (each idea must use a different one)
- angle: the distinctive point of view in a phrase
- pillar: the assigned pillar
- format: the post format that fits best
- whyNow: why this earns feed space today; use structural reasoning unless dated evidence supports timeliness
- hookConcept: the idea for the first ${ctx.prefs.constraints.hook_max_chars} characters, before the fold. A concept, not final copy.
- coreArgument: the "so what", in full
- audienceTakeaway: what the reader does or believes differently afterwards
- supportingEvidence: only claims traceable to the evidence above, each with its sourceUrl and sourceTitle. Leave empty rather than inventing.
- noveltyNote: why this is not the generic take on the subject
- risks: anything that could make this land badly
- estimatedStrength: your honest 1-100 assessment`

  let candidates: GeneratedIdeaItem[] = []
  let modelError: string | null = null

  try {
    const result = await generateText({
      model: handle.model,
      providerOptions: handle.providerOptions,
      instructions: systemPrompt,
      prompt: userPrompt,
      output: Output.object({ schema: IdeasGenerationSchema })
    })

    const usage = readUsage(result.usage)
    usageTotals.inputTokens += usage.inputTokens
    usageTotals.outputTokens += usage.outputTokens
    usageTotals.totalTokens += usage.totalTokens
    usageTotals.cacheReadTokens += usage.cacheReadTokens
    costUsd += estimateCostUsd(handle.modelId, usage)

    candidates = result.output?.ideas || []
  } catch (err: any) {
    modelError = err?.message || 'Idea generation failed'
    console.error('Idea generation failed:', err)
  }

  // ------------------------------------------------------- validate + rank
  const validated: GeneratedIdeaItem[] = []
  const discarded: Array<{ title: string; reason: string }> = []

  for (const candidate of candidates) {
    const result = validateIdea(candidate, corpus)
    if (!result.isValid) {
      discarded.push({
        title: candidate.title,
        reason: result.issues[0] || 'Failed grounding checks'
      })
      continue
    }
    validated.push(result.idea)
  }

  const diversity = filterDiverseIdeas(validated, targetIdeas)
  let selected = diversity.selected

  // Novelty against what this account has already published.
  if (recentDrafts.length > 0) {
    selected = selected.filter(idea => {
      const novelty = checkNovelty(
        idea.hookConcept,
        `${idea.thesis} ${idea.coreArgument}`,
        recentDrafts.map(d => ({ hook: d.hook, body: d.body }))
      )
      if (!novelty.isNovel) {
        discarded.push({
          title: idea.title,
          reason: novelty.reason || 'Too similar to a recent post'
        })
        return false
      }
      return true
    })
  }

  for (const [index, idea] of selected.entries()) {
    await db.insert(ideasTable).values({
      accountId: ctx.account.id,
      runId,
      goalId: ctx.primaryGoal?.id ?? null,
      title: idea.title,
      thesis: idea.thesis,
      perspectiveAngle: idea.perspectiveAngle,
      hook: idea.hookConcept,
      angle: idea.angle,
      pillar: idea.pillar || assignedPillars[index]?.name || null,
      format: idea.format,
      whyNow: idea.whyNow,
      hookConcept: idea.hookConcept,
      coreArgument: idea.coreArgument,
      audienceTakeaway: idea.audienceTakeaway,
      supportingEvidence: idea.supportingEvidence,
      // The media mode comes from the account's policy; the human can override
      // it per idea at the approval gate.
      suggestedMedia: {
        mode: ctx.prefs.media.default_mode,
        brief: idea.suggestedMedia?.brief
      },
      noveltyNote: idea.noveltyNote,
      score: idea.estimatedStrength,
      groundingScore: idea.groundingScore ?? 80,
      originalityScore: idea.originalityScore ?? 80,
      unsupportedClaims: idea.unsupportedClaims || [],
      sourceIds: idea.sourceIds || [],
      risks: idea.risks || [],
      status: 'proposed'
    })
  }

  const averageGrounding =
    selected.length > 0
      ? Math.round(
          selected.reduce((sum, i) => sum + (i.groundingScore ?? 80), 0) /
            selected.length
        )
      : 0

  if (ideationStep) {
    await db
      .update(runStepsTable)
      .set({
        status: selected.length > 0 ? 'completed' : 'failed',
        completedAt: new Date(),
        durationMs: Date.now() - ideationStart,
        tokens: usageTotals.totalTokens,
        costUsd: costUsd.toFixed(4),
        error: selected.length === 0 ? modelError || 'No idea survived grounding and novelty checks' : null,
        responseJson: {
          generated: candidates.length,
          survivedGrounding: validated.length,
          selected: selected.length,
          discarded,
          perspectiveAngles: selected.map(i => i.perspectiveAngle),
          averageGroundingScore: averageGrounding,
          cacheReadTokens: usageTotals.cacheReadTokens
        }
      })
      .where(eq(runStepsTable.id, ideationStep.id))
  }

  if (selected.length === 0) {
    const message =
      modelError ||
      'No idea survived grounding and novelty checks. Add knowledge base sources or relax the research policy, then run again.'
    await db
      .update(runsTable)
      .set({
        status: 'failed',
        error: message,
        tokenCounts: usageTotals,
        costUsd: costUsd.toFixed(4),
        model: handle.modelId
      })
      .where(eq(runsTable.id, runId))
    throw new Error(message)
  }

  await db
    .update(runsTable)
    .set({
      status: 'awaiting_idea_approval',
      currentStep: 2,
      totalSteps: 3,
      tokenCounts: usageTotals,
      costUsd: costUsd.toFixed(4),
      model: handle.modelId,
      error: null
    })
    .where(eq(runsTable.id, runId))

  return {
    ideasCount: selected.length,
    findingsCount: findings.length,
    runId,
    status: 'awaiting_idea_approval'
  }
}
