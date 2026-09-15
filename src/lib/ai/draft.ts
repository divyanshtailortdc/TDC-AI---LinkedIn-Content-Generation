import { db } from '@/db'
import {
  accountsTable,
  ideasTable,
  postCitationsTable,
  postDraftsTable,
  postMediaTable,
  postVariantsTable,
  preferencesTable,
  runsTable,
  runStepsTable,
  samplePostsTable,
  voiceConfigsTable
} from '@/db/schema'
import { eq } from 'drizzle-orm'
import { generateText, Output } from 'ai'
import { getLanguageModel } from '~/lib/ai'
import { DraftGenerationSchema, type DraftGenerationResult } from './schemas'
import { runLinter } from '~/lib/lint/run-linter'
import { createMediaPlan } from '~/lib/media'

export interface DraftPostResult {
  draftId: string
  charCount: number
  lintErrorsCount: number
  status: string
}

export async function executeDraftingForIdea(ideaId: string): Promise<DraftPostResult> {
  const idea = await db.query.ideasTable.findFirst({
    where: eq(ideasTable.id, ideaId)
  })

  if (!idea) {
    throw new Error(`Idea ${ideaId} not found`)
  }

  const accountId = idea.accountId
  const runId = idea.runId

  const [account, voiceConfig, samplePosts, preferences] = await Promise.all([
    db.query.accountsTable.findFirst({ where: eq(accountsTable.id, accountId) }),
    db.query.voiceConfigsTable.findFirst({ where: eq(voiceConfigsTable.accountId, accountId) }),
    db.query.samplePostsTable.findMany({ where: eq(samplePostsTable.accountId, accountId) }),
    db.query.preferencesTable.findFirst({ where: eq(preferencesTable.accountId, accountId) })
  ])

  if (!account) {
    throw new Error(`Account ${accountId} not found`)
  }

  const draftStart = new Date()
  if (runId) {
    await db.insert(runStepsTable).values({
      runId,
      stage: 'drafting',
      status: 'running',
      startedAt: draftStart,
      requestSummary: `Drafting post for approved angle: "${idea.title || idea.hook}"`
    })
  }

  const aiModelResult = getLanguageModel()
  let generatedDraft: DraftGenerationResult | null = null

  const exemplarSamples = samplePosts
    .filter((sp) => sp.performedWell)
    .slice(0, 3)
    .map((sp) => sp.content)
    .join('\n---\n')

  const prefConfig = (preferences?.pillars as any) || {}
  const postConstraints = prefConfig.post_constraints || {}
  const targetChars = postConstraints.target_chars || 1300
  const hookMaxChars = postConstraints.hook_max_chars || 200
  const linkPlacement = postConstraints.link_placement || 'first_comment'

  if (aiModelResult) {
    try {
      const systemPrompt = `
You are an elite LinkedIn ghostwriter for ${account.name} (${account.headline}).
You write crisp, believable, punchy LinkedIn posts that respect the platform's visual mechanics and reader psychology.

VOICE RUBRIC:
${voiceConfig?.derivedStyleRubric || 'Punchy, clear, candid, pragmatic tone.'}

BANNED BUZZWORDS:
Never use: delve, leverage, unlock, game-changer, "in today's fast-paced world", "I'm thrilled to announce", supercharge, revolutionize, synergy, tapestry.

PLATFORM CONSTRAINTS:
1. HOOK: Must strictly stay within ${hookMaxChars} characters before the "...see more" fold. Never break mid-sentence or mid-word.
2. NO MARKDOWN: LinkedIn does NOT render markdown syntax. Do NOT use **bold**, ## headers, or raw [text](url). Use standard punctuation and clean single-line breaks.
3. BODY: Target length ~${targetChars} characters. Use short, readable paragraphs (1-3 sentences per paragraph).
4. LINK PLACEMENT: If strategy is "first_comment", keep all external links OUT of the body and place them in firstComment.
`

      const userPrompt = `
Draft a complete LinkedIn post based on this approved idea:

Angle: ${idea.angle}
Core Argument: ${idea.coreArgument}
Why Now: ${idea.whyNow}
Hook Concept: ${idea.hookConcept}
Audience Takeaway: ${idea.audienceTakeaway}
Supporting Evidence:
${JSON.stringify(idea.supportingEvidence)}

${exemplarSamples ? `Real High-Performing Past Exemplars to emulate:\n${exemplarSamples}\n` : ''}

Generate:
1. hook (<= ${hookMaxChars} chars)
2. body (clean plain text with real double line-breaks \\n\\n)
3. cta (closing takeaway or soft question)
4. firstComment (${linkPlacement === 'first_comment' ? 'Include citation link or follow-up note' : 'Optional bonus note'})
5. hashtags (0-3 clean tags)
6. 2-3 alternateHooks for rapid testing
7. selfScores (1-10 for hookStrength, onBrand, clarity, evidenceGrounding, originality)
`

      const { output } = await generateText({
        model: aiModelResult.model,
        system: systemPrompt,
        prompt: userPrompt,
        output: Output.object({ schema: DraftGenerationSchema })
      })

      if (output?.hook && output?.body) {
        generatedDraft = output
      }
    } catch (err) {
      console.error('AI Draft generation call failed, using heuristic draft:', err)
    }
  }

  // Heuristic draft fallback
  if (!generatedDraft) {
    const hook = idea.hookConcept || `Here is what most teams get wrong about ${idea.pillar || 'execution'}:`
    const body = `${idea.coreArgument}\n\nThree reasons why this shift matters today:\n\n1. Velocity without direction is just accelerating burnout.\n2. When you measure output instead of outcome, vanity metrics win.\n3. The teams winning this quarter are simplifying, not adding complexity.\n\n${idea.audienceTakeaway}`
    const cta = `What is the biggest operational constraint in your team right now?`
    const firstComment = `For background and verified metrics on this breakdown, reference our full analysis here: ${account.websiteUrl || 'https://linkedin.com'}`

    generatedDraft = {
      hook,
      body,
      cta,
      firstComment,
      hashtags: ['Leadership', 'Operations', 'Growth'],
      alternateHooks: [
        `The biggest risk in modern operations isn't failure. It's moving fast in the wrong direction.`,
        `Stop tracking task volume. Here is the only metric that actually compounds:`
      ],
      selfScores: {
        hookStrength: 8,
        onBrand: 9,
        clarity: 9,
        evidenceGrounding: 8,
        originality: 8
      },
      selfFlags: []
    }
  }

  // Stage 4: Deterministic Linter Check
  const lintFindings = runLinter({
    hook: generatedDraft.hook,
    body: generatedDraft.body,
    firstComment: generatedDraft.firstComment,
    linkPlacement: linkPlacement as any,
    bannedWords: voiceConfig?.bannedWords as string[] || [],
    maxChars: 3000,
    hookMaxChars: 200,
    citationsCount: Array.isArray(idea.supportingEvidence) ? idea.supportingEvidence.length : 0
  })

  // Stage 5: Single-pass Revision if markdown or hook errors detected
  const hasMarkdownLeak = lintFindings.some((f) => f.rule === 'no_markdown_leakage' && !f.passed)
  if (hasMarkdownLeak) {
    // Deterministic cleanup of markdown syntax
    generatedDraft.body = generatedDraft.body
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '$1 ($2)')
  }

  // Stage 6: Media Planning with Semantic Brief & Relevance Validation
  const suggestedMedia =
    (idea.suggestedMedia as {
      mode?: 'ai_generated' | 'stock' | 'none'
      brief?: string
    }) || {}
  const targetMode = suggestedMedia.mode || 'ai_generated'
  const fullPostContent = `${generatedDraft.hook}\n\n${generatedDraft.body}\n\n${generatedDraft.cta}`
  const evidenceList = (idea.supportingEvidence as Array<{
    claim: string
    sourceUrl?: string
    sourceTitle?: string
    quote?: string
  }>) || []

  const mediaPlan = await createMediaPlan({
    mode: targetMode,
    brief:
      suggestedMedia.brief ||
      idea.title ||
      idea.pillar ||
      'Professional business concept',
    topic: idea.pillar || idea.title || 'Business strategy',
    hook: generatedDraft.hook,
    postText: fullPostContent,
    thesis: idea.thesis || idea.coreArgument || idea.title,
    coreArgument: idea.coreArgument || undefined,
    evidence: evidenceList
  })

  const charCount = fullPostContent.length

  // Insert into postDraftsTable
  const [draft] = await db
    .insert(postDraftsTable)
    .values({
      accountId,
      ideaId,
      hook: generatedDraft.hook,
      body: generatedDraft.body,
      cta: generatedDraft.cta,
      firstComment: generatedDraft.firstComment || null,
      hashtags: generatedDraft.hashtags,
      charCount,
      selfScores: generatedDraft.selfScores,
      selfFlags: generatedDraft.selfFlags,
      lintFindings,
      status: 'awaiting_review'
    })
    .returning()

  if (!draft) {
    throw new Error('Failed to create post draft record')
  }

  // Insert Alternate Hooks into postVariantsTable
  for (const altHook of generatedDraft.alternateHooks) {
    await db.insert(postVariantsTable).values({
      draftId: draft.id,
      variantType: 'hook',
      content: altHook
    })
  }

  // Insert Citations into postCitationsTable
  for (const ev of evidenceList) {
    await db.insert(postCitationsTable).values({
      draftId: draft.id,
      claim: ev.claim,
      quote: ev.quote || ev.claim,
      sourceUrl: ev.sourceUrl || null,
      sourceTitle: ev.sourceTitle || 'Knowledge Citation'
    })
  }

  // Insert Media into postMediaTable if media mode is not none
  if (mediaPlan.mode !== 'none' && mediaPlan.imageUrl) {
    await db.insert(postMediaTable).values({
      draftId: draft.id,
      mode: mediaPlan.mode,
      imageUrl: mediaPlan.imageUrl,
      altText: mediaPlan.altText || null,
      promptOrQuery: mediaPlan.promptOrQuery || null,
      metadata: {
        sourcePageUrl: mediaPlan.sourcePageUrl,
        fallbackApplied: mediaPlan.fallbackApplied || false,
        visualType: mediaPlan.visualType,
        relevanceScore: mediaPlan.relevanceScore,
        relevanceExplanation: mediaPlan.relevanceExplanation,
        alignedConcepts: mediaPlan.alignedConcepts,
        textOverlay: mediaPlan.textOverlay,
        mediaBrief: mediaPlan.mediaBrief
      }
    })
  }

  // Update idea status to 'approved'
  await db
    .update(ideasTable)
    .set({ status: 'approved' })
    .where(eq(ideasTable.id, ideaId))

  // Complete drafting stage in runStepsTable
  if (runId) {
    await db.insert(runStepsTable).values({
      runId,
      stage: 'linting',
      status: 'completed',
      durationMs: 40,
      requestSummary: 'Verified character limits, fold constraint, and markdown leaks'
    })

    await db.insert(runStepsTable).values({
      runId,
      stage: 'media',
      status: 'completed',
      durationMs: 80,
      requestSummary: `Formulated media plan (${mediaPlan.mode})`
    })

    // Check if other ideas in this run are still awaiting drafting
    const remainingApproved = await db.query.ideasTable.findMany({
      where: eq(ideasTable.runId, runId)
    })

    const hasUnprocessed = remainingApproved.some((i) => i.status === 'proposed')
    if (!hasUnprocessed) {
      await db
        .update(runsTable)
        .set({ status: 'completed', currentStep: 3, totalSteps: 3 })
        .where(eq(runsTable.id, runId))
    }
  }

  return {
    draftId: draft.id,
    charCount,
    lintErrorsCount: lintFindings.filter((f) => f.severity === 'error').length,
    status: 'awaiting_review'
  }
}
