import { db } from '@/db'
import {
  ideasTable,
  postDraftsTable,
  researchFindingsTable,
  runStepsTable,
  runsTable
} from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { env } from '~/env'
import { EMPTY_USAGE, getLanguageModel, type CallUsage } from '~/lib/ai'
import { checkNovelty } from '~/lib/novelty'
import {
  isWebSearchConfigured,
  runWebSearch,
  type Finding
} from '~/lib/research/web-search'
import { runResearchAgent } from '../agents/research'
import {
  loadGenerationContext,
  pickWeightedPillars,
  type GenerationContext
} from '../context'
import { retrieveKnowledgePassages, type KnowledgePassage } from '../embeddings'
import { filterDiverseIdeas } from '../idea-diversity'
import { refreshRunTotals } from '../run-accounting'
import { SkillError } from '../run-skill'
import {
  generateIdeas,
  type GeneratedIdeaItem,
  type GroundingCorpus
} from '../skills/ideation'

/**
 * A run's first half: gather context, research (fixed search or the research
 * agent), assemble the evidence corpus, run the ideation skill, then keep the
 * ideas that are diverse and new for this account. Every stage is recorded as
 * a run step; ideas wait for human approval before anything is drafted.
 */

export interface ResearchIdeateResult {
  ideasCount: number
  findingsCount: number
  runId: string
  status: string
}

/** Knowledge documents this run may draw on: all of the account's. */
function selectKnowledgeDocs(ctx: GenerationContext) {
  return ctx.knowledgeDocs
}

function buildGroundingCorpus(
  ctx: GenerationContext,
  findings: Finding[],
  passages: KnowledgePassage[] = []
): GroundingCorpus {
  const verifiedClaims: GroundingCorpus['verifiedClaims'] = []
  const docs = selectKnowledgeDocs(ctx)

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

  // Verbatim passages, so the quote is the passage itself.
  const docsById = new Map(docs.map(d => [d.id, d]))
  for (const passage of passages) {
    const doc = docsById.get(passage.documentId)
    if (!doc) continue
    verifiedClaims.push({
      claim: passage.content,
      quote: passage.content,
      sourceUrl: doc.sourceUrl || undefined,
      sourceTitle: doc.title,
      sourceId: doc.id
    })
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

type WebResearch = {
  findings: Finding[]
  queries: string[]
  mode: 'fixed' | 'agent' | 'off'
  usage: CallUsage
  /** Agent details, or why it fell back to fixed search. */
  details: Record<string, unknown>
}

/**
 * Fixed search unless RESEARCH_MODE=agent. The agent falls back to fixed
 * search on any failure, so a run never loses its research to it.
 */
async function researchTheWeb(ctx: GenerationContext): Promise<WebResearch> {
  if (!ctx.prefs.research.use_web_search || !isWebSearchConfigured) {
    return {
      findings: [],
      queries: [],
      mode: 'off',
      usage: EMPTY_USAGE,
      details: {}
    }
  }

  let fallbackReason: string | null = null
  if (env.RESEARCH_MODE === 'agent') {
    try {
      const agent = await runResearchAgent(ctx)
      if (agent.findings.length > 0) {
        return {
          findings: agent.findings,
          queries: agent.queries,
          mode: 'agent',
          usage: agent.usage,
          details: {
            pagesRead: agent.pagesRead,
            rejectedFindings: agent.rejected,
            agentSteps: agent.steps,
            model: agent.modelId
          }
        }
      }
      fallbackReason = `The research agent returned no verifiable findings (${agent.rejected} rejected).`
      // Its spend still counts.
      const fixed = await runFixedSearch(ctx)
      return {
        ...fixed,
        usage: agent.usage,
        details: { fallbackReason, agentQueries: agent.queries }
      }
    } catch (err) {
      console.warn('Research agent failed; using fixed search:', err)
      fallbackReason =
        err instanceof Error ? err.message : 'Research agent failed'
    }
  }

  const fixed = await runFixedSearch(ctx)
  return fallbackReason ? { ...fixed, details: { fallbackReason } } : fixed
}

async function runFixedSearch(ctx: GenerationContext): Promise<WebResearch> {
  const queries: string[] = []
  const findings = await runWebSearch(ctx, q => queries.push(q))
  return { findings, queries, mode: 'fixed', usage: EMPTY_USAGE, details: {} }
}

export async function executeResearchAndIdeate(
  runId: string
): Promise<ResearchIdeateResult> {
  const run = await db.query.runsTable.findFirst({
    where: eq(runsTable.id, runId)
  })
  if (!run) throw new Error(`Run ${runId} not found`)

  const ctx = await loadGenerationContext(run.accountId, { goalId: run.goalId })

  let ideationUsage: CallUsage = EMPTY_USAGE

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

  const targetIdeas = Math.max(3, Math.min(ctx.prefs.ideasPerRun || 5, 12))

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
  const [researchStep] = await db
    .insert(runStepsTable)
    .values({
      runId,
      stage: 'researching',
      status: 'running',
      startedAt: new Date(),
      requestSummary: !ctx.prefs.research.use_web_search
        ? 'Reading the knowledge base (web search disabled in preferences)'
        : env.RESEARCH_MODE === 'agent'
          ? 'Research agent searching the web and reading pages, plus the knowledge base'
          : 'Searching the web and reading the knowledge base'
    })
    .returning()

  await db
    .update(runsTable)
    .set({ status: 'researching' })
    .where(eq(runsTable.id, runId))

  const research = await researchTheWeb(ctx)
  const findings = research.findings

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

  const passages = await retrieveKnowledgePassages(
    ctx,
    selectKnowledgeDocs(ctx)
  )
  const corpus = buildGroundingCorpus(ctx, findings, passages)

  if (researchStep) {
    await db
      .update(runStepsTable)
      .set({
        status: 'completed',
        completedAt: new Date(),
        durationMs: Date.now() - researchStart,
        // The agent's model calls are spend; fixed search costs no tokens.
        tokens: research.usage.totalTokens,
        costUsd: research.usage.costUsd.toFixed(4),
        responseJson: {
          mode: research.mode,
          queries: research.queries,
          webFindings: findings.length,
          knowledgeClaims:
            corpus.verifiedClaims.length - findings.length - passages.length,
          knowledgePassages: passages.length,
          totalEvidence: corpus.verifiedClaims.length,
          ...research.details,
          usage: research.usage
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

  let candidates: GeneratedIdeaItem[] = []
  let validated: GeneratedIdeaItem[] = []
  const discarded: Array<{ title: string; reason: string }> = []
  let modelError: string | null = null

  try {
    const ideation = await generateIdeas({
      ctx,
      corpus,
      recentHooks: recentDrafts.slice(0, 12).map(d => d.hook),
      candidateCount,
      assignedPillars: assignedPillars.map(p => p.name)
    })
    ideationUsage = ideation.usage
    candidates = ideation.candidates
    validated = ideation.valid
    discarded.push(...ideation.discarded)
  } catch (err: any) {
    modelError = err?.message || 'Idea generation failed'
    // Tokens billed before a schema rejection still count.
    if (err instanceof SkillError) ideationUsage = err.usage
    console.error('Idea generation failed:', err)
  }

  // ------------------------------------------------------------ diversity
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
      // No image by default; one can be added per post on the review screen.
      // The brief is kept so that image starts from the idea's direction.
      suggestedMedia: {
        mode: 'none',
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
        tokens: ideationUsage.totalTokens,
        costUsd: ideationUsage.costUsd.toFixed(4),
        error:
          selected.length === 0
            ? modelError || 'No idea survived grounding and novelty checks'
            : null,
        responseJson: {
          generated: candidates.length,
          survivedGrounding: validated.length,
          selected: selected.length,
          discarded,
          perspectiveAngles: selected.map(i => i.perspectiveAngle),
          averageGroundingScore: averageGrounding,
          model: handle.modelId,
          usage: ideationUsage
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
      .set({ status: 'failed', error: message, model: handle.modelId })
      .where(eq(runsTable.id, runId))
    // A failed run still spent money; keep the totals honest.
    await refreshRunTotals(runId)
    throw new Error(message)
  }

  await db
    .update(runsTable)
    .set({
      status: 'awaiting_idea_approval',
      currentStep: 2,
      totalSteps: 3,
      model: handle.modelId,
      error: null
    })
    .where(eq(runsTable.id, runId))

  await refreshRunTotals(runId)

  return {
    ideasCount: selected.length,
    findingsCount: findings.length,
    runId,
    status: 'awaiting_idea_approval'
  }
}
