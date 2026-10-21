import { db } from '@/db'
import {
  ideasTable,
  researchFindingsTable,
  runStepsTable,
  runsTable,
  type Run
} from '@/db/schema'
import { eq } from 'drizzle-orm'
import { env } from '~/env'
import { EMPTY_USAGE, getLanguageModel, type CallUsage } from '~/lib/ai'
import {
  isWebSearchConfigured,
  runWebSearch,
  type Finding
} from '~/lib/research/web-search'
import { ResearchAgentError, runResearchAgent } from '../agents/research'
import {
  audienceSegments,
  goalLabel,
  loadGenerationContext,
  renderIdeationHistoryBlock,
  snapshotGoal,
  withReaderGroup,
  type GenerationContext
} from '../context'
import { retrieveKnowledgePassages } from '../embeddings'
import { selectIdeas, spreadGoals } from '../idea-selection'
import { inferRegion } from '../region'
import { recordStepUsage, refreshRunTotals } from '../run-accounting'
import { failRun, keepRunAlive } from '../run-lifecycle'
import { SkillError } from '../run-skill'
import { generateIdeas, type GeneratedIdeaItem } from '../skills/ideation'
import { buildGroundingCorpus } from './grounding-corpus'

/**
 * A run's first half: gather context, research (fixed search or the research
 * agent), assemble the evidence corpus, run the ideation skill, then keep the
 * ideas that are diverse and new for this account. Every stage is recorded as
 * a run step; ideas wait for human approval before anything is drafted.
 *
 * The goals picked for the run steer all of it: research searches for them,
 * retrieval looks for them, and each idea serves one of them and is saved
 * with it. No other goal reaches any prompt.
 *
 * The run ends either awaiting approval with all of its ideas, or failed with
 * none of them and no step left running. Spend is saved as soon as it is
 * billed, so neither ending loses it.
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
  let agentUsage: CallUsage = EMPTY_USAGE
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
      // The steps it finished before failing were still billed.
      if (err instanceof ResearchAgentError) agentUsage = err.usage
    }
  }

  const fixed = await runFixedSearch(ctx)
  return fallbackReason
    ? { ...fixed, usage: agentUsage, details: { fallbackReason } }
    : fixed
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

  // A throw fails the run here; if the process dies instead, the stopped
  // heartbeat lets the worker fail it (see run-lifecycle).
  const stopHeartbeat = keepRunAlive(runId)
  try {
    return await researchAndIdeate(run)
  } catch (err) {
    await failRun(runId, err).catch(cleanupErr =>
      console.error(`Could not mark run ${runId} failed:`, cleanupErr)
    )
    throw err
  } finally {
    stopHeartbeat()
  }
}

/** The run's goals; a run queued before goal_ids existed has only goal_id. */
export function goalIdsOfRun(run: Pick<Run, 'goalIds' | 'goalId'>): string[] {
  if (run.goalIds && run.goalIds.length > 0) return run.goalIds
  return run.goalId ? [run.goalId] : []
}

async function researchAndIdeate(run: Run): Promise<ResearchIdeateResult> {
  const runId = run.id
  const ctx = await loadGenerationContext(run.accountId, {
    goalIds: goalIdsOfRun(run)
  })
  // A goal deleted after the run was queued drops out; with none left there
  // is nothing to write toward. The caller fails the run with this message.
  if (ctx.selectedGoals.length === 0) {
    throw new Error(
      'None of the goals picked for this run exist any more. Start a new run and pick at least one goal.'
    )
  }

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
        'Consolidating identity, offerings, audiences, knowledge base and the selected goals'
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
          readerGroups: audienceSegments(ctx).map(s => s.label),
          region: inferRegion(ctx)?.name ?? null,
          knowledgeDocs: ctx.knowledgeDocs.length,
          goals: ctx.selectedGoals.map(g => g.title),
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
  if (researchStep) await recordStepUsage(runId, researchStep.id, research.usage)

  if (findings.length > 0) {
    await db.insert(researchFindingsTable).values(
      findings.map(f => ({
        runId,
        url: f.url,
        title: f.title,
        snippet: f.snippet,
        publishedAt: f.publishedAt ?? null,
        provider: f.provider
      }))
    )
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
          recentEvidence: corpus.verifiedClaims.filter(c => c.isFresh).length,
          knowledgeClaims: corpus.sources.knowledgeClaims,
          knowledgePassages: passages.length,
          documentSummaries: corpus.sources.documentSummaries,
          offeringFacts: corpus.sources.offeringFacts,
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
    // Failing the run also closes the ideation step with this message.
    throw new Error(
      'No AI provider configured. Add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to generate ideas.'
    )
  }

  // Over-generate so grounding and diversity filters have something to cut.
  const candidateCount = Math.min(targetIdeas + 3, 15)
  // Each candidate is asked for one goal, the goals in turn, so every goal
  // picked for the run gets candidates of its own.
  const assignedGoals = spreadGoals(
    ctx.selectedGoals.map((_, i) => goalLabel(i)),
    candidateCount
  )

  // Earlier posts and ideas, so "fresh angle" means fresh for this account.
  // Ideas count whatever their status: re-proposing one the reviewer rejected
  // or has not got to yet is as much a repeat as re-proposing a post.
  const pastWork = [
    ...ctx.history.drafts.map(d => ({ hook: d.hook, body: d.body })),
    ...ctx.history.ideas
      .filter(i => i.runId !== runId)
      .map(i => ({
        hook: i.hookConcept,
        body: `${i.title} ${i.thesis} ${i.coreArgument}`
      }))
  ]

  let candidates: GeneratedIdeaItem[] = []
  let validated: GeneratedIdeaItem[] = []
  const discarded: Array<{ title: string; reason: string }> = []
  let modelError: string | null = null

  try {
    const ideation = await generateIdeas({
      ctx,
      corpus,
      history: renderIdeationHistoryBlock(ctx, runId),
      candidateCount,
      assignedGoals
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
  if (ideationStep) await recordStepUsage(runId, ideationStep.id, ideationUsage)

  // ------------------------------------------------------------ selection
  // Repeats of earlier work go first, so they cannot take a place from a
  // fresh idea; then the most varied set up to the target is kept.
  const picked = selectIdeas(
    validated,
    pastWork,
    targetIdeas,
    ctx.selectedGoals.map(g => g.id)
  )
  const selected = picked.selected
  discarded.push(...picked.discarded)

  const averageGrounding =
    selected.length > 0
      ? Math.round(
          selected.reduce((sum, i) => sum + (i.groundingScore ?? 80), 0) /
            selected.length
        )
      : 0

  const ideationOutcome = {
    completedAt: new Date(),
    durationMs: Date.now() - ideationStart,
    tokens: ideationUsage.totalTokens,
    costUsd: ideationUsage.costUsd.toFixed(4),
    responseJson: {
      generated: candidates.length,
      survivedGrounding: validated.length,
      selected: selected.length,
      discarded,
      perspectiveAngles: selected.map(i => i.perspectiveAngle),
      ideasPerGoal: ctx.selectedGoals.map(g => ({
        goal: g.title,
        ideas: selected.filter(i => i.goalId === g.id).length
      })),
      averageGroundingScore: averageGrounding,
      model: handle.modelId,
      usage: ideationUsage
    }
  }

  if (selected.length === 0) {
    if (ideationStep) {
      await db
        .update(runStepsTable)
        .set({
          ...ideationOutcome,
          status: 'failed',
          error:
            modelError || 'No idea survived grounding and novelty checks'
        })
        .where(eq(runStepsTable.id, ideationStep.id))
    }
    // The caller fails the run with this message and settles its totals.
    throw new Error(
      modelError ||
        'No idea survived grounding and novelty checks. Add knowledge base sources or relax the research policy, then run again.'
    )
  }

  // One transaction: inserting ideas row by row meant a failure part-way
  // (a model-written value too long for its column, say) left some ideas
  // saved on a run that then read as failed.
  const goalsById = new Map(ctx.selectedGoals.map(g => [g.id, g]))
  await db.transaction(async tx => {
    await tx.insert(ideasTable).values(
      selected.map(idea => {
        // Validation guarantees one of the run's goals.
        const goal = goalsById.get(idea.goalId!)!
        return {
        accountId: ctx.account.id,
        runId,
        goalId: goal.id,
        goalSnapshot: snapshotGoal(goal),
        title: idea.title,
        thesis: idea.thesis,
        perspectiveAngle: idea.perspectiveAngle,
        hook: idea.hookConcept,
        angle: idea.angle,
        format: idea.format,
        whyNow: idea.whyNow,
        hookConcept: idea.hookConcept,
        coreArgument: idea.coreArgument,
        audienceTakeaway: withReaderGroup(
          idea.audienceTakeaway,
          idea.targetAudience
        ),
        supportingEvidence: idea.supportingEvidence,
        // No image by default; one can be added per post on the review screen.
        // The brief is kept so that image starts from the idea's direction.
        suggestedMedia: {
          mode: 'none' as const,
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
        }
      })
    )

    if (ideationStep) {
      await tx
        .update(runStepsTable)
        .set({ ...ideationOutcome, status: 'completed', error: null })
        .where(eq(runStepsTable.id, ideationStep.id))
    }

    await tx
      .update(runsTable)
      .set({
        status: 'awaiting_idea_approval',
        currentStep: 2,
        totalSteps: 3,
        model: handle.modelId,
        error: null
      })
      .where(eq(runsTable.id, runId))
  })

  await refreshRunTotals(runId)

  return {
    ideasCount: selected.length,
    findingsCount: findings.length,
    runId,
    status: 'awaiting_idea_approval'
  }
}
