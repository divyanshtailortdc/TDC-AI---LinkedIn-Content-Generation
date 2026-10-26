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
import { addUsage } from '~/lib/ai/usage'
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
import {
  coverEveryGoal,
  ideaTarget,
  selectIdeas,
  spreadGoals
} from '../idea-selection'
import { checkNovelty } from '../../novelty'
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

/**
 * A run still going after this is failed, so a stage that never finishes
 * cannot hold the worker, which runs one run at a time. The heartbeat keeps a
 * stuck run looking alive, so the stale-run sweep would never catch it. The
 * slowest legitimate run is about 12 minutes: the research agent (3 min) and
 * its fixed-search fallback, retrieval, and two ideation calls (3 min each).
 */
const RUN_DEADLINE_MS = 15 * 60_000

const DEADLINE_MESSAGE =
  'The run took longer than 15 minutes and was stopped. Start a new run.'

/** Rejects once `signal` aborts, whether or not `work` has finished. */
function untilDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const stop = () => reject(new Error(DEADLINE_MESSAGE))
      if (signal.aborted) stop()
      else signal.addEventListener('abort', stop, { once: true })
    })
  ])
}

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
  // heartbeat lets the worker fail it (see run-lifecycle). Past the deadline
  // the run is failed and the worker freed; the deadline also cancels the
  // model calls under way, and keeps late work from saving ideas.
  const deadline = AbortSignal.timeout(RUN_DEADLINE_MS)
  const stopHeartbeat = keepRunAlive(runId)
  try {
    return await untilDeadline(researchAndIdeate(run, deadline), deadline)
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

async function researchAndIdeate(
  run: Run,
  deadline: AbortSignal
): Promise<ResearchIdeateResult> {
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

  // Every goal picked leads at least one idea, so more goals than the usual
  // ideas per run make a bigger run.
  const targetIdeas = ideaTarget(
    ctx.prefs.ideasPerRun,
    ctx.selectedGoals.length
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

  // The web and the knowledge base are read at once: neither needs the other.
  const [research, passages] = await Promise.all([
    researchTheWeb(ctx),
    retrieveKnowledgePassages(ctx, selectKnowledgeDocs(ctx))
  ])
  const findings = research.findings
  if (researchStep) await recordStepUsage(runId, researchStep.id, research.usage)

  // Past the deadline the run is already failed; stop before saving to it.
  deadline.throwIfAborted()
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
  const discarded: Array<{ title: string; reason: string; goalId?: string }> =
    []
  let modelError: string | null = null

  try {
    const ideation = await generateIdeas({
      ctx,
      corpus,
      history: renderIdeationHistoryBlock(ctx, runId),
      candidateCount,
      assignedGoals,
      abortSignal: deadline
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
  // fresh idea; then the most varied set up to the target is kept, with
  // every goal leading at least one idea where a candidate allows.
  const goalIds = ctx.selectedGoals.map(g => g.id)
  const picked = selectIdeas(validated, pastWork, targetIdeas, goalIds)
  let selected = picked.selected
  let uncovered = picked.uncovered
  discarded.push(...picked.discarded)

  // A goal the user picked but no usable idea serves gets one more try, for
  // that goal alone: a second model call only when coverage needs it.
  let retried = false
  if (uncovered.length > 0 && selected.length > 0 && !modelError) {
    retried = true
    const missing = uncovered.map(id => goalLabel(goalIds.indexOf(id)))
    try {
      const retry = await generateIdeas({
        ctx,
        corpus,
        history: [
          renderIdeationHistoryBlock(ctx, runId),
          `ALREADY PROPOSED IN THIS RUN — do not repeat these:\n${selected.map(i => `- ${i.title}`).join('\n')}`
        ]
          .filter(Boolean)
          .join('\n\n'),
        candidateCount: missing.length * 2,
        assignedGoals: spreadGoals(missing, missing.length * 2),
        abortSignal: deadline
      })
      ideationUsage = addUsage(ideationUsage, retry.usage)
      candidates = [...candidates, ...retry.candidates]
      validated = [...validated, ...retry.valid]
      discarded.push(...retry.discarded)
      const fresh = retry.valid.filter(
        idea =>
          checkNovelty(
            idea.hookConcept,
            `${idea.title} ${idea.thesis} ${idea.coreArgument}`,
            pastWork
          ).isNovel
      )
      const covered = coverEveryGoal(selected, fresh, goalIds, targetIdeas)
      selected = covered.selected
      uncovered = covered.uncovered
    } catch (err) {
      // The run keeps what it has; the goal is reported as uncovered.
      if (err instanceof SkillError) {
        ideationUsage = addUsage(ideationUsage, err.usage)
      }
      console.warn('Ideation retry for uncovered goals failed:', err)
    }
    if (ideationStep) {
      await recordStepUsage(runId, ideationStep.id, ideationUsage)
    }
  }

  // Why each goal left without an idea has none, for the run page.
  const uncoveredGoals = uncovered.map(id => {
    const lost = discarded.find(d => d.goalId === id)
    return {
      goalId: id,
      goal: ctx.selectedGoals.find(g => g.id === id)?.title ?? id,
      reason: lost
        ? `Its ideas did not pass the checks. "${lost.title}": ${lost.reason}`
        : 'No usable idea was written for it.'
    }
  })

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
        ideas: selected.filter(i => i.goalId === g.id).length,
        alsoServedBy: selected.filter(
          i => i.goalId !== g.id && (i.goalIds ?? []).includes(g.id)
        ).length
      })),
      retriedForGoals: retried,
      uncoveredGoals,
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
    // Inside the transaction, so a run failed at its deadline meanwhile
    // gets neither the ideas nor the status that goes with them.
    deadline.throwIfAborted()
    await tx.insert(ideasTable).values(
      selected.map(idea => {
        // Validation guarantees one of the run's goals.
        const goal = goalsById.get(idea.goalId!)!
        return {
        accountId: ctx.account.id,
        runId,
        goalId: goal.id,
        goalIds: idea.goalIds?.length ? idea.goalIds : [goal.id],
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
        // Drafting gives every post an image designed from its text; the
        // brief is kept so that image starts from the idea's direction.
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
