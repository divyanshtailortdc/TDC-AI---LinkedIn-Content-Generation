import { db } from '@/db'
import {
  ideasTable,
  postCitationsTable,
  postDraftsTable,
  postMediaTable,
  postVariantsTable,
  runStepsTable,
  runsTable
} from '@/db/schema'
import { eq } from 'drizzle-orm'
import { generateText, NoObjectGeneratedError, Output } from 'ai'
import {
  addUsage,
  EMPTY_USAGE,
  EPHEMERAL_CACHE,
  getLanguageModel,
  readCallUsage,
  type CallUsage
} from '~/lib/ai'
import { refreshRunTotals } from './run-accounting'
import {
  collectBannedWords,
  describeHashtags,
  loadGenerationContext,
  renderAudienceBlock,
  renderConstraintsBlock,
  renderGoalBlock,
  renderGuardrailsBlock,
  renderIdentityBlock,
  renderVoiceBlock,
  type GenerationContext
} from './context'
import { DraftGenerationSchema, type DraftGenerationResult } from './schemas'
import { runLinter, type LintFinding, type LintOptions } from '~/lib/lint/run-linter'
import { createMediaPlan } from '~/lib/media'

export interface DraftPostResult {
  draftId: string
  charCount: number
  lintErrorsCount: number
  status: string
}

/** The exemplars that teach rhythm better than any slider can. */
function renderExemplars(ctx: GenerationContext): string {
  const exemplars = ctx.samplePosts
    .slice()
    .sort((a, b) => Number(b.performedWell) - Number(a.performedWell))
    .slice(0, 4)

  if (exemplars.length === 0) return ''

  return exemplars
    .map((s, i) => {
      const label = s.performedWell
        ? `Example ${i + 1} (performed well${s.engagementNote ? `: ${s.engagementNote}` : ''})`
        : `Example ${i + 1}`
      return `${label}:\n"""\n${s.content}\n"""`
    })
    .join('\n\n')
}

export async function executeDraftingForIdea(
  ideaId: string
): Promise<DraftPostResult> {
  const idea = await db.query.ideasTable.findFirst({
    where: eq(ideasTable.id, ideaId)
  })
  if (!idea) throw new Error(`Idea ${ideaId} not found`)

  const runId = idea.runId
  const ctx = await loadGenerationContext(idea.accountId, {
    goalId: idea.goalId
  })

  const constraints = ctx.prefs.constraints
  const goal = ctx.primaryGoal
  const linkPlacement = constraints.link_placement

  const draftStart = Date.now()
  const [draftStep] = runId
    ? await db
        .insert(runStepsTable)
        .values({
          runId,
          stage: 'drafting',
          status: 'running',
          startedAt: new Date(),
          requestSummary: `Drafting "${idea.title || idea.hook}"`
        })
        .returning()
    : [null]

  const handle = getLanguageModel('drafting')
  if (!handle) {
    const message =
      'No AI provider configured. Add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to draft posts.'
    if (draftStep) {
      await db
        .update(runStepsTable)
        .set({ status: 'failed', completedAt: new Date(), error: message })
        .where(eq(runStepsTable.id, draftStep.id))
    }
    throw new Error(message)
  }

  // Kept apart so each lands on its own run step: the draft, the optional
  // revision pass, and the media plan are separate spend.
  let draftUsage: CallUsage = EMPTY_USAGE
  let revisionUsage: CallUsage = EMPTY_USAGE

  const exemplars = renderExemplars(ctx)
  const guardrails = renderGuardrailsBlock(ctx)

  /**
   * Everything stable for this account and goal goes in one block so it can be
   * cached. Every draft after the first in a run reads this prefix instead of
   * paying for it again.
   */
  const stableSystem = `You are a ghostwriter producing a finished LinkedIn post for one specific author. You write in their voice, not yours, and you never invent facts.

AUTHOR
${renderIdentityBlock(ctx)}

READER
${renderAudienceBlock(ctx)}

GOAL THIS POST SERVES
${renderGoalBlock(goal)}

VOICE — match this precisely
${renderVoiceBlock(ctx)}

PLATFORM AND FORMAT RULES
${renderConstraintsBlock(ctx)}
${guardrails ? `\nGUARDRAILS\n${guardrails}` : ''}

TRUTH RULES
- Use only the evidence supplied with the idea. If a number is not in that evidence, do not write a number.
- Never claim first-hand experience that is not in the evidence.
- Write plain text. Real line breaks, no markdown of any kind.
${exemplars ? `\nHOW THIS AUTHOR ACTUALLY WRITES — match the rhythm, structure and idiom of these real posts:\n\n${exemplars}` : ''}`

  const ideaBrief = `Write the post for this approved idea.

Title: ${idea.title}
Thesis: ${idea.thesis || ''}
Angle: ${idea.angle || ''}
Why now: ${idea.whyNow || ''}
Hook concept (turn this into real copy, do not copy it verbatim): ${idea.hookConcept || idea.hook}
Core argument: ${idea.coreArgument || ''}
Reader takeaway: ${idea.audienceTakeaway || ''}

EVIDENCE YOU MAY USE (nothing outside this):
${
  (idea.supportingEvidence || []).length > 0
    ? (idea.supportingEvidence || [])
        .map(
          (e, i) =>
            `[${i + 1}] ${e.claim}${e.quote ? `\n    Quote: "${e.quote}"` : ''}${e.sourceTitle ? `\n    Source: ${e.sourceTitle}` : ''}${e.sourceUrl ? `\n    URL: ${e.sourceUrl}` : ''}`
        )
        .join('\n')
    : 'No external evidence was gathered. Write from reasoning alone and state no statistics.'
}

Produce:
1. hook — at most ${constraints.hook_max_chars} characters, a complete thought that survives the fold
2. body — plain text, about ${constraints.target_chars} characters total including the hook
3. cta — ${constraints.cta_required ? 'required' : 'optional'}${goal?.desiredAction ? `; steer toward: ${goal.desiredAction}` : ''}
4. firstComment — ${
    linkPlacement === 'first_comment'
      ? `place any link here${goal?.targetUrl ? ` (use ${goal.targetUrl})` : ''}`
      : 'optional supporting note'
  }
5. hashtags — ${describeHashtags(constraints)}, without the # symbol
6. alternateHooks — ${Math.max(2, Math.min(constraints.variants_per_post, 3))} genuinely different openings
7. selfScores — honest 1-10 ratings`

  async function callModel(
    userContent: string,
    record: (usage: CallUsage) => void
  ): Promise<DraftGenerationResult | null> {
    try {
      const result = await generateText({
        model: handle!.model,
        providerOptions: handle!.providerOptions,
        // The stable block goes through `instructions` so it renders ahead of the
        // messages, and carries cacheControl so later drafts in the run read it
        // from cache instead of paying for it again.
        instructions: [
          {
            role: 'system',
            content: stableSystem,
            providerOptions: EPHEMERAL_CACHE
          }
        ],
        messages: [{ role: 'user', content: userContent }],
        output: Output.object({ schema: DraftGenerationSchema })
      })

      record(readCallUsage(result, handle!.modelId))
      return result.output ?? null
    } catch (err) {
      // Tokens generated before a schema rejection were still billed.
      if (NoObjectGeneratedError.isInstance(err)) {
        record(readCallUsage({ usage: err.usage }, handle!.modelId))
      }
      throw err
    }
  }

  const recordDraft = (u: CallUsage) => {
    draftUsage = addUsage(draftUsage, u)
  }
  const recordRevision = (u: CallUsage) => {
    revisionUsage = addUsage(revisionUsage, u)
  }

  /** A failed draft still spent tokens; record them so run totals stay true. */
  async function failDraftStep(message: string) {
    if (!draftStep || !runId) return
    await db
      .update(runStepsTable)
      .set({
        status: 'failed',
        completedAt: new Date(),
        error: message,
        tokens: draftUsage.totalTokens,
        costUsd: draftUsage.costUsd.toFixed(4),
        responseJson: { model: handle!.modelId, usage: draftUsage }
      })
      .where(eq(runStepsTable.id, draftStep.id))
    await refreshRunTotals(runId)
  }

  let draft: DraftGenerationResult | null = null
  try {
    draft = await callModel(ideaBrief, recordDraft)
  } catch (err: any) {
    const message = err?.message || 'Draft generation failed'
    await failDraftStep(message)
    throw new Error(message)
  }

  if (!draft?.hook || !draft?.body) {
    const message = 'The model returned an incomplete draft.'
    await failDraftStep(message)
    throw new Error(message)
  }

  if (draftStep) {
    await db
      .update(runStepsTable)
      .set({
        status: 'completed',
        completedAt: new Date(),
        durationMs: Date.now() - draftStart,
        tokens: draftUsage.totalTokens,
        costUsd: draftUsage.costUsd.toFixed(4),
        responseJson: {
          model: handle.modelId,
          usage: draftUsage
        }
      })
      .where(eq(runStepsTable.id, draftStep.id))
  }

  // ------------------------------------------------------------------- lint
  const evidence = idea.supportingEvidence || []
  const lintOptions = (d: DraftGenerationResult): LintOptions => ({
    hook: d.hook,
    body: d.body,
    cta: d.cta,
    firstComment: d.firstComment,
    hashtags: d.hashtags,
    linkPlacement,
    bannedWords: collectBannedWords(ctx),
    bannedTopics: ctx.prefs.guardrails.banned_topics,
    maxChars: constraints.max_chars,
    hookMaxChars: constraints.hook_max_chars,
    hashtagRange: constraints.hashtags,
    emojiLevel: constraints.emoji_level,
    ctaRequired: constraints.cta_required,
    citationsCount: evidence.length,
    minCitations: ctx.prefs.research.min_citations_per_post
  })

  const lintStart = Date.now()
  let lintFindings: LintFinding[] = runLinter(lintOptions(draft))
  let revised = false

  // --------------------------------------------------------- single revision
  const blocking = lintFindings.filter(f => f.severity === 'error' && !f.passed)
  if (blocking.length > 0) {
    try {
      const revision = await callModel(
        `${ideaBrief}

Your previous draft failed these checks. Rewrite it so every one passes, keeping the argument and the voice intact.

PREVIOUS DRAFT
Hook: ${draft.hook}
Body:
${draft.body}
CTA: ${draft.cta}

FAILED CHECKS
${blocking.map(f => `- ${f.message}`).join('\n')}`,
        recordRevision
      )
      if (revision?.hook && revision?.body) {
        const revisedFindings = runLinter(lintOptions(revision))
        const revisedBlocking = revisedFindings.filter(
          f => f.severity === 'error' && !f.passed
        )
        // Only keep the rewrite if it actually improved matters.
        if (revisedBlocking.length < blocking.length) {
          draft = revision
          lintFindings = revisedFindings
          revised = true
        }
      }
    } catch (err) {
      console.warn('Revision pass failed; keeping the original draft:', err)
    }
  }

  if (runId) {
    await db.insert(runStepsTable).values({
      runId,
      stage: 'linting',
      status: 'completed',
      startedAt: new Date(lintStart),
      completedAt: new Date(),
      durationMs: Date.now() - lintStart,
      requestSummary: revised
        ? 'Checked platform rules, then revised once to clear blocking findings'
        : 'Checked platform rules, character limits, guardrails and citations',
      tokens: revisionUsage.totalTokens,
      costUsd: revisionUsage.costUsd.toFixed(4),
      responseJson: {
        revised,
        // The revision pass is a full second draft call; its cost belongs here.
        revisionAttempted: revisionUsage.calls > 0,
        failed: lintFindings.filter(f => !f.passed).map(f => f.rule),
        errors: lintFindings.filter(f => f.severity === 'error' && !f.passed).length,
        usage: revisionUsage
      }
    })
  }

  // ------------------------------------------------------------------ media
  const suggested = (idea.suggestedMedia || {}) as {
    mode?: 'ai_generated' | 'stock' | 'none'
    brief?: string
  }
  // The idea carries the human's per-idea override from the approval gate;
  // otherwise no image, and one can be added from the review screen.
  const mediaMode = suggested.mode || 'none'
  const fullPostText = [draft.hook, draft.body, draft.cta]
    .filter(Boolean)
    .join('\n\n')

  const mediaStart = Date.now()
  const mediaPlan = await createMediaPlan({
    mode: mediaMode,
    brief: suggested.brief || null,
    topic: idea.pillar || idea.title,
    hook: draft.hook,
    postText: fullPostText,
    thesis: idea.thesis || idea.coreArgument || idea.title,
    coreArgument: idea.coreArgument || undefined,
    evidence,
    accountName: ctx.account.name
  })

  if (runId && mediaMode !== 'none') {
    await db.insert(runStepsTable).values({
      runId,
      stage: 'media',
      status: mediaPlan.imageUrl ? 'completed' : 'failed',
      startedAt: new Date(mediaStart),
      completedAt: new Date(),
      durationMs: Date.now() - mediaStart,
      requestSummary: `Media plan (${mediaPlan.mode})`,
      error: mediaPlan.imageUrl ? null : mediaPlan.error || 'No image produced',
      tokens: mediaPlan.usage?.totalTokens ?? 0,
      costUsd: (mediaPlan.usage?.costUsd ?? 0).toFixed(4),
      responseJson: {
        mode: mediaPlan.mode,
        fallbackApplied: mediaPlan.fallbackApplied || false,
        relevanceScore: mediaPlan.relevanceScore,
        concept: mediaPlan.mediaBrief?.primaryConcept,
        imageAttempts: mediaPlan.imageAttempts ?? 0,
        usage: mediaPlan.usage ?? EMPTY_USAGE
      }
    })
  }

  // ----------------------------------------------------------------- persist
  const charCount = fullPostText.length

  const [saved] = await db
    .insert(postDraftsTable)
    .values({
      accountId: ctx.account.id,
      ideaId,
      hook: draft.hook,
      body: draft.body,
      cta: draft.cta,
      firstComment: draft.firstComment || null,
      hashtags: draft.hashtags,
      format: idea.format || 'thought_leadership',
      charCount,
      selfScores: draft.selfScores,
      selfFlags: draft.selfFlags,
      lintFindings,
      status: 'awaiting_review'
    })
    .returning()

  if (!saved) throw new Error('Failed to create post draft record')

  const variantLimit = Math.max(1, Math.min(constraints.variants_per_post, 5))
  for (const altHook of (draft.alternateHooks || []).slice(0, variantLimit)) {
    await db.insert(postVariantsTable).values({
      draftId: saved.id,
      variantType: 'hook',
      content: altHook
    })
  }

  for (const ev of evidence) {
    await db.insert(postCitationsTable).values({
      draftId: saved.id,
      claim: ev.claim,
      quote: ev.quote || null,
      sourceUrl: ev.sourceUrl || null,
      sourceTitle: ev.sourceTitle || null
    })
  }

  if (mediaPlan.mode !== 'none' && mediaPlan.imageUrl) {
    await db.insert(postMediaTable).values({
      draftId: saved.id,
      mode: mediaPlan.mode,
      imageUrl: mediaPlan.imageUrl,
      altText: mediaPlan.altText || null,
      promptOrQuery: mediaPlan.promptOrQuery || null,
      metadata: {
        sourcePageUrl: mediaPlan.sourcePageUrl,
        fallbackApplied: mediaPlan.fallbackApplied || false,
        relevanceScore: mediaPlan.relevanceScore,
        relevanceExplanation: mediaPlan.relevanceExplanation,
        mediaBrief: mediaPlan.mediaBrief
      }
    })
  }

  await db
    .update(ideasTable)
    .set({ status: 'drafted', updatedAt: new Date() })
    .where(eq(ideasTable.id, ideaId))

  // ----------------------------------------------------- run bookkeeping
  if (runId) {
    const runIdeas = await db.query.ideasTable.findMany({
      where: eq(ideasTable.runId, runId)
    })
    // A run is finished once nothing is still approved and waiting to be drafted.
    const pending = runIdeas.some(i => i.status === 'approved')

    await db
      .update(runsTable)
      .set({
        status: pending ? 'drafting' : 'completed',
        currentStep: pending ? 2 : 3,
        totalSteps: 3
      })
      .where(eq(runsTable.id, runId))

    await refreshRunTotals(runId)
  }

  return {
    draftId: saved.id,
    charCount,
    lintErrorsCount: lintFindings.filter(
      f => f.severity === 'error' && !f.passed
    ).length,
    status: 'awaiting_review'
  }
}
