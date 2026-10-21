import assert from 'node:assert'
import { describe, it } from 'node:test'
import type { Account, Goal, Idea } from '../src/db/schema'
import { buildPrompt as buildResearchPrompt } from '../src/lib/ai/agents/research/prompt'
import {
  EMPTY_HISTORY,
  goalText,
  ideaGoalTitles,
  resolvePreferences,
  snapshotGoal,
  withIdeaGoal,
  type GenerationContext
} from '../src/lib/ai/context-blocks'
import {
  coverEveryGoal,
  ideaTarget,
  selectIdeas,
  spreadGoals
} from '../src/lib/ai/idea-selection'
import {
  buildGroundingCorpus,
  buildRetrievalQueries
} from '../src/lib/ai/pipeline/grounding-corpus'
import {
  describeDraftSelection,
  planDraftSelection
} from '../src/lib/ai/pipeline/draft-selection'
import {
  MAX_GOALS_PER_IDEA,
  resolveGeneratedIdea,
  resolveGoalRefs,
  validateIdea
} from '../src/lib/ai/skills/ideation/guard'
import type { GeneratedIdeaItem } from '../src/lib/ai/skills/ideation/schema'
import { collectFigureSources } from '../src/lib/ai/skills/post-drafting/guard'
import * as ideationPrompt from '../src/lib/ai/skills/ideation/prompt'
import type { IdeaGenerationItem } from '../src/lib/ai/skills/ideation/schema'
import * as draftingPrompt from '../src/lib/ai/skills/post-drafting/prompt'
import { buildSearchQueries, searchCountFor } from '../src/lib/research/findings'
import { checkRunGoals, GoalSelectionError } from '../src/jobs/run-goals'

/**
 * Picking goals for a run has to change what is generated, not just what the
 * screen shows. Each stage is built here from a context that knows three goals
 * of which two were picked, and must carry the picked ones and nothing of the
 * third: its title, its message, its figures and its link.
 */

const now = new Date('2026-10-01T00:00:00Z')

const account: Account = {
  id: 'acc',
  userId: null,
  name: 'Ledgerly',
  handle: 'ledgerly',
  headline: 'Bookkeeping for D2C brands',
  bio: 'Ledgerly keeps the books for direct-to-consumer brands.',
  avatarUrl: null,
  accountType: 'company',
  company: 'Ledgerly',
  websiteUrl: null,
  linkedinUrl: null,
  industry: 'Accounting',
  isActive: true,
  createdAt: now,
  updatedAt: now
}

function goal(id: string, overrides: Partial<Goal>): Goal {
  return {
    id,
    accountId: 'acc',
    title: id,
    objective: 'authority',
    keyMessage: null,
    desiredAction: null,
    targetUrl: null,
    linkStrategy: 'first_comment',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

const close = goal('goal-close', {
  title: 'Faster month-end close',
  objective: 'lead_gen',
  keyMessage: 'Daily reconciliation cuts month-end close time by 70%.',
  desiredAction: 'Book a close review',
  targetUrl: 'https://ledgerly.example/close-review',
  linkStrategy: 'body'
})
const hiring = goal('goal-hiring', {
  title: 'Hire senior accountants',
  objective: 'recruiting',
  keyMessage: 'Our team grew 40% this year because accountants want modern tooling.',
  desiredAction: 'Apply for a role',
  targetUrl: 'https://ledgerly.example/careers'
})
const gst = goal('goal-gst', {
  title: 'Explain input tax credit',
  objective: 'awareness',
  keyMessage: 'Most D2C founders leave input tax credit unclaimed every quarter.'
})

/** All three goals exist; `selected` are the ones this generation serves. */
function context(selected: Goal[]): GenerationContext {
  return {
    account,
    voice: null,
    offerings: [],
    audiences: [],
    knowledgeDocs: [],
    samplePosts: [],
    goals: [close, hiring, gst],
    selectedGoals: selected,
    primaryGoal: selected[0] ?? null,
    preferencesId: null,
    prefs: resolvePreferences(null, null),
    history: EMPTY_HISTORY
  }
}

/** A run that picked the close and tax-credit goals, not hiring. */
const run = context([close, gst])

function generated(overrides: Partial<IdeaGenerationItem>): IdeaGenerationItem {
  return {
    title: 'Close the books daily',
    thesis: 'Reconciling every day keeps month-end small.',
    perspectiveAngle: 'process_breakdown',
    angle: 'Close is a daily habit',
    goalRefs: ['G1'],
    audienceRef: '',
    format: 'thought_leadership',
    whyNow: 'Month-end keeps slipping for growing brands.',
    hookConcept: 'Month-end is late because the other days are skipped.',
    coreArgument: 'Reconciling every day keeps month-end small.',
    audienceTakeaway: 'Reconcile daily.',
    supportingEvidence: [],
    noveltyNote: 'Treats close as a habit, not an event.',
    estimatedStrength: 80,
    risks: [],
    ...overrides
  }
}

const goalIds = run.selectedGoals.map(g => g.id)
const fit = { goals: goalIds, audiences: [] }
const corpus = buildGroundingCorpus(run, [])
const check = (item: IdeaGenerationItem) =>
  validateIdea(resolveGeneratedIdea(item, [], [], goalIds), corpus, fit)

describe('the goals picked for a run decide what ideation sees', () => {
  const instructions = ideationPrompt.buildInstructions(run)

  it('lists each picked goal under the label an idea cites, with its message', () => {
    assert.match(instructions, /\[G1\] Faster month-end close/)
    assert.match(instructions, /\[G2\] Explain input tax credit/)
    assert.ok(instructions.includes(close.keyMessage!))
    assert.ok(instructions.includes(gst.keyMessage!))
  })

  it('carries nothing of a goal that was not picked', () => {
    for (const leak of [
      hiring.title,
      hiring.keyMessage!,
      hiring.desiredAction!,
      hiring.targetUrl!
    ]) {
      assert.ok(!instructions.includes(leak), leak)
    }
  })

  it('has no content pillars left in it', () => {
    assert.doesNotMatch(instructions, /pillar/i)
  })

  it('asks for one goal per idea, the picked goals in turn', () => {
    const prompt = ideationPrompt.buildPrompt({
      corpus,
      history: '',
      candidateCount: 5,
      assignedGoals: spreadGoals(['G1', 'G2'], 5),
      hookMaxChars: 200,
      today: now
    })
    assert.match(prompt, /G1 \| G2 \| G1 \| G2 \| G1/)
    assert.match(prompt, /goalRefs/)
    assert.doesNotMatch(prompt, /pillar/i)
  })
})

describe('an idea is kept only when it serves a picked goal', () => {
  it('resolves its goal label to that goal and passes the brief', () => {
    const result = check(generated({ goalRefs: ['G2'] }))
    assert.strictEqual(result.idea.goalId, gst.id)
    assert.strictEqual(result.offBrief, false)
  })

  it('turns away a label that points at no picked goal', () => {
    const result = check(generated({ goalRefs: ['G3'] }))
    assert.strictEqual(result.isValid, false)
    assert.match(result.rejectionReason!, /none of the goals selected/)
  })

  it('turns away an idea naming no goal when several were picked', () => {
    const result = check(generated({ goalRefs: [] }))
    assert.strictEqual(result.isValid, false)
    assert.strictEqual(result.offBrief, true)
  })

  it('turns away an idea for a goal outside the run, however it got there', () => {
    const idea = resolveGeneratedIdea(generated({}), [], [], goalIds)
    const outside = validateIdea(
      { ...idea, goalId: hiring.id, goalIds: [hiring.id] },
      corpus,
      fit
    )
    assert.strictEqual(outside.isValid, false)

    // Beside a picked goal, the outside one is dropped and never kept.
    const mixed = validateIdea(
      { ...idea, goalId: hiring.id, goalIds: [hiring.id, gst.id] },
      corpus,
      fit
    )
    assert.strictEqual(mixed.isValid, true)
    assert.strictEqual(mixed.idea.goalId, gst.id)
    assert.deepStrictEqual(mixed.idea.goalIds, [gst.id])
  })

  it('gives the only goal of a one-goal run to an idea that names none', () => {
    const single = [gst.id]
    const idea = resolveGeneratedIdea(generated({ goalRefs: [] }), [], [], single)
    const result = validateIdea(idea, buildGroundingCorpus(context([gst]), []), {
      goals: single,
      audiences: []
    })
    assert.strictEqual(result.idea.goalId, gst.id)
    assert.strictEqual(result.offBrief, false)
  })

  it("grounds a figure in a picked goal's message, but not one from a goal left out", () => {
    const own = check(
      generated({ coreArgument: 'Daily reconciliation cuts close time by 70%.' })
    )
    assert.ok(!own.issues.some(i => i.includes('70%')), own.issues.join('; '))

    const leaked = check(
      generated({ coreArgument: 'Teams like ours grew 40% this year.' })
    )
    assert.strictEqual(leaked.isValid, false)
    assert.match(leaked.rejectionReason!, /"40%"/)
  })
})

describe('research and the knowledge base look for the picked goals', () => {
  it('fixed search queries name the picked goals, never the one left out', () => {
    const queries = buildSearchQueries(run, 3)
    assert.ok(queries.some(q => q.includes(close.title)), queries.join(' | '))
    assert.ok(queries.some(q => q.includes(gst.title)), queries.join(' | '))
    assert.ok(!queries.some(q => /hire|accountant/i.test(q)), queries.join(' | '))
  })

  it("covers every picked goal before using any goal's message", () => {
    const queries = buildSearchQueries(context([close, gst, hiring]), 3)
    assert.deepStrictEqual(
      queries.map(q => q.replace(/^Ledgerly /, '').replace(/^Accounting /, '')),
      [close.title, gst.title, hiring.title]
    )
  })

  it('the research agent is briefed on the picked goals only', () => {
    const prompt = buildResearchPrompt(run, 30)
    assert.ok(prompt.includes(close.keyMessage!))
    assert.ok(prompt.includes(gst.keyMessage!))
    assert.ok(!prompt.includes(hiring.keyMessage!))
    assert.ok(!prompt.includes(hiring.title))
  })

  it('retrieval runs one query per picked goal', () => {
    assert.deepStrictEqual(buildRetrievalQueries(run), [
      goalText(close),
      goalText(gst)
    ])
  })

  it('ranks the documents a goal matched ahead of the rest', () => {
    const doc = (id: string, summary: string) =>
      ({
        id,
        accountId: 'acc',
        title: id,
        sourceType: 'artifact',
        sourceUrl: null,
        content: summary,
        author: null,
        publishedAt: null,
        wordCount: 10,
        summary,
        topics: [],
        keyClaims: [],
        createdAt: now,
        updatedAt: now
      }) as GenerationContext['knowledgeDocs'][number]
    const withDocs = {
      ...run,
      knowledgeDocs: [
        doc('hiring-handbook', 'How we hire accountants.'),
        doc('itc-guide', 'Input tax credit is claimable on most inputs.')
      ]
    }
    const passages = [
      { documentId: 'itc-guide', content: 'Claim it quarterly.', similarity: 0.8 }
    ]
    const ranked = buildGroundingCorpus(withDocs, [], passages)
    const summaries = ranked.verifiedClaims
      .filter(c => c.claim.endsWith('.') && c.sourceTitle !== undefined)
      .map(c => c.sourceTitle)
    assert.ok(
      summaries.indexOf('itc-guide') < summaries.indexOf('hiring-handbook'),
      summaries.join(' | ')
    )
  })
})

function idea(overrides: Partial<Idea>): Idea {
  return {
    id: 'idea-1',
    accountId: 'acc',
    runId: 'run-1',
    goalId: null,
    goalIds: [],
    goalSnapshot: null,
    offeringId: null,
    title: 'Close the books daily',
    hook: 'Month-end is late because the other days are skipped.',
    angle: 'Close is a daily habit',
    pillar: null,
    format: 'thought_leadership',
    thesis: 'Reconciling every day keeps month-end small.',
    perspectiveAngle: 'process_breakdown',
    whyNow: null,
    hookConcept: 'Month-end is late because the other days are skipped.',
    coreArgument: 'Reconciling every day keeps month-end small.',
    audienceTakeaway: 'Reconcile daily.',
    supportingEvidence: [],
    suggestedMedia: { mode: 'none' },
    noveltyNote: null,
    score: 80,
    groundingScore: 80,
    originalityScore: 80,
    unsupportedClaims: [],
    sourceIds: [],
    risks: [],
    status: 'approved',
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

/** Every drafting prompt for the idea, with the context drafting would load. */
function draftingText(forIdea: Idea): string {
  // Drafting loads the idea's goal only (see loadIdeaContext); every goal the
  // account has is in `goals` so a leak would show.
  const ctx = withIdeaGoal(context([close, hiring, gst]), forIdea)
  return [
    draftingPrompt.buildInstructions(ctx),
    draftingPrompt.buildPrompt(ctx, forIdea)
  ].join('\n')
}

describe("a post is written for its own idea's goal", () => {
  it("lands that goal's message, call to action and link, and no other goal's", () => {
    const text = draftingText(idea({ goalId: close.id }))
    assert.ok(text.includes(close.keyMessage!))
    assert.ok(text.includes(close.desiredAction!))
    // The close goal puts its link in the body.
    assert.ok(text.includes(`include this link once, near the call to action: ${close.targetUrl}`))
    for (const other of [hiring, gst]) {
      assert.ok(!text.includes(other.keyMessage!), other.title)
      assert.ok(!text.includes(other.title), other.title)
    }
    assert.ok(!text.includes(hiring.targetUrl!))
  })

  it('uses the goal as it is now, so a corrected link reaches the post', () => {
    const stale = snapshotGoal({ ...close, targetUrl: 'https://old.example/x' })
    const text = draftingText(idea({ goalId: close.id, goalSnapshot: stale }))
    assert.ok(text.includes(close.targetUrl!))
    assert.ok(!text.includes('https://old.example/x'))
  })

  it("keeps a deleted goal's message from the copy the idea kept", () => {
    const deleted = snapshotGoal({
      ...gst,
      keyMessage: 'Unclaimed input credit is free money left on the table.'
    })
    const text = draftingText(idea({ goalId: null, goalSnapshot: deleted }))
    assert.ok(text.includes('Unclaimed input credit is free money left on the table.'))
    assert.ok(!text.includes(close.keyMessage!))
  })

  it('writes an idea made without a goal without one, not with whichever goal is active', () => {
    const text = draftingText(idea({ goalId: null, goalSnapshot: null }))
    assert.match(text, /No goal was set for this post/)
    for (const g of [close, hiring, gst]) {
      assert.ok(!text.includes(g.keyMessage!), g.title)
    }
  })
})

describe('a run starts only with goals it may use', () => {
  const owned = [
    { id: 'a', title: 'A', isActive: true },
    { id: 'b', title: 'B', isActive: true },
    { id: 'p', title: 'Paused goal', isActive: false }
  ]

  it('keeps the order the goals were picked in, once each', () => {
    assert.deepStrictEqual(checkRunGoals(['b', 'a', 'b'], owned), ['b', 'a'])
  })

  it('refuses a run with no goal, a goal of another identity, or a paused goal', () => {
    assert.throws(() => checkRunGoals([], owned), /at least one goal/)
    assert.throws(() => checkRunGoals(['someone-elses'], owned), /Goal not found/)
    assert.throws(() => checkRunGoals(['a', 'p'], owned), /"Paused goal" is paused/)
    assert.throws(() => checkRunGoals([], owned), GoalSelectionError)
  })
})

describe('posts are drafted only from selected, approved ideas', () => {
  const found = [
    { id: 'approved-1', status: 'approved' },
    { id: 'approved-2', status: 'approved' },
    { id: 'proposed', status: 'proposed' },
    { id: 'rejected', status: 'rejected' },
    { id: 'drafted', status: 'drafted' },
    { id: 'stale-claim', status: 'drafting' }
  ]

  it('drafts the selected approved ideas, in the order selected, and nothing else', () => {
    const plan = planDraftSelection(
      ['stale-claim', 'proposed', 'approved-1', 'rejected', 'drafted', 'gone'],
      found
    )
    // approved-2 was not selected, so it is not drafted.
    assert.deepStrictEqual(plan.draftable, ['stale-claim', 'approved-1'])
    assert.strictEqual(plan.notApproved, 2)
    assert.strictEqual(plan.alreadyDrafted, 1)
    assert.strictEqual(plan.notFound, 1)
  })

  it('drafts nothing when nothing is selected', () => {
    assert.deepStrictEqual(planDraftSelection([], found).draftable, [])
  })

  it('tells the reviewer why a selected idea did not become a post', () => {
    assert.match(
      describeDraftSelection({ drafted: 0, notApproved: 2, alreadyDrafted: 0, notFound: 0 }),
      /2 selected ideas are not approved.*Approve them first/
    )
    assert.strictEqual(
      describeDraftSelection({ drafted: 3, notApproved: 0, alreadyDrafted: 0, notFound: 0 }),
      ''
    )
  })
})

describe('content pillars no longer reach generation', () => {
  it('ignores pillars an account saved before', () => {
    const prefs = resolvePreferences({
      id: 'p',
      accountId: 'acc',
      pillars: [{ name: 'Legacy pillar', weight_pct: 100, example_topics: ['Old topic'] }],
      ideasPerRun: 5,
      postConstraints: null,
      guardrails: null,
      createdAt: now,
      updatedAt: now
    })
    assert.ok(!('pillars' in prefs))
    const ctx = { ...run, prefs }
    const everything = [
      ideationPrompt.buildInstructions(ctx),
      buildSearchQueries(ctx, 3).join('\n'),
      buildResearchPrompt(ctx, 30),
      buildRetrievalQueries(ctx).join('\n')
    ].join('\n')
    assert.ok(!everything.includes('Legacy pillar'))
    assert.ok(!everything.includes('Old topic'))
  })
})

describe('a run for several goals represents every one of them', () => {
  it('makes at least one idea per picked goal, between 3 and 12', () => {
    assert.strictEqual(ideaTarget(5, 1), 5)
    assert.strictEqual(ideaTarget(5, 3), 5)
    assert.strictEqual(ideaTarget(5, 7), 7)
    assert.strictEqual(ideaTarget(5, 20), 12)
    assert.strictEqual(ideaTarget(2, 1), 3)
  })

  it('reads the main goal first and any other goal an idea also serves', () => {
    assert.deepStrictEqual(resolveGoalRefs(['G2', 'G1', 'G2', 'G9'], ['a', 'b']), {
      goalId: 'b',
      goalIds: ['b', 'a']
    })
    assert.deepStrictEqual(resolveGoalRefs([], ['a']), { goalId: undefined, goalIds: [] })
  })

  it(`keeps only picked goals on an idea, main first, at most ${MAX_GOALS_PER_IDEA}`, () => {
    const four = context([close, gst, hiring, goal('goal-d', { title: 'D' })])
    const ids = four.selectedGoals.map(g => g.id)
    const idea = resolveGeneratedIdea(generated({}), [], [], ids)
    const result = validateIdea(
      { ...idea, goalIds: ['goal-d', 'not-picked', close.id, gst.id, hiring.id] },
      buildGroundingCorpus(four, []),
      { goals: ids, audiences: [] }
    )
    assert.strictEqual(result.idea.goalId, 'goal-d')
    assert.deepStrictEqual(result.idea.goalIds, ['goal-d', close.id, gst.id])
  })

  /** A candidate as selection sees it: written for `goalId`, ranked by `score`. */
  const candidate = (title: string, goalId: string, thesis: string, score: number) =>
    ({
      title,
      goalId,
      goalIds: [goalId],
      thesis,
      coreArgument: thesis,
      hookConcept: `Hook about ${title}`,
      perspectiveAngle: 'process_breakdown',
      estimatedStrength: score,
      groundingScore: score,
      originalityScore: score
    }) as GeneratedIdeaItem

  const a1 = candidate('a1', 'A', 'Weekly reconciliation keeps month-end close short.', 95)
  const a2 = candidate('a2', 'A', 'Founders should read cash flow before profit.', 90)
  const a3 = candidate('a3', 'A', 'Payroll errors start with unapproved timesheets.', 85)

  it("gives a goal left without an idea its best spare, in place of another goal's extra", () => {
    const spareB = candidate('b1', 'B', 'Freight invoices hide unclaimed input credit.', 60)
    const { selected, added, uncovered } = coverEveryGoal([a1, a2, a3], [spareB], ['A', 'B'], 3)
    assert.deepStrictEqual(selected.map(i => i.title), ['a1', 'a2', 'b1'])
    assert.deepStrictEqual(added.map(i => i.title), ['b1'])
    assert.deepStrictEqual(uncovered, [])
  })

  it('will not cover a goal with a near copy of an idea already picked', () => {
    const copy = candidate('c1', 'C', 'Weekly reconciliation keeps month-end close short.', 99)
    const { selected, uncovered } = coverEveryGoal([a1, a2, a3], [copy], ['A', 'C'], 3)
    assert.deepStrictEqual(selected.map(i => i.title), ['a1', 'a2', 'a3'])
    assert.deepStrictEqual(uncovered, ['C'])
  })

  it('reports the goals no candidate could cover, for the retry and the run page', () => {
    const { uncovered } = selectIdeas([a1, a2], [], 3, ['A', 'B', 'C'])
    assert.deepStrictEqual(uncovered, ['B', 'C'])
  })

  it('a one-goal run asks for every idea under that goal and needs no cover', () => {
    assert.deepStrictEqual(spreadGoals(['G1'], 4), ['G1', 'G1', 'G1', 'G1'])
    const { selected, uncovered } = selectIdeas([a1, a2, a3], [], 3, ['A'])
    assert.strictEqual(selected.length, 3)
    assert.deepStrictEqual(uncovered, [])
  })

  it('searches the web once for each picked goal, beyond the usual three', () => {
    const five = context([
      close,
      gst,
      hiring,
      goal('goal-d', { title: 'Payroll accuracy' }),
      goal('goal-e', { title: 'Inventory valuation' })
    ])
    assert.strictEqual(searchCountFor(five), 5)
    assert.strictEqual(searchCountFor(run), 3)
    const queries = buildSearchQueries(five, searchCountFor(five))
    for (const title of five.selectedGoals.map(g => g.title)) {
      assert.ok(queries.some(q => q.includes(title)), `${title}: ${queries.join(' | ')}`)
    }
  })
})

describe('an idea serving several goals', () => {
  const both = idea({ goalId: close.id, goalIds: [close.id, gst.id] })

  it("is drafted for its main goal's ask and link, reinforcing the other goal's message", () => {
    const text = draftingText(both)
    assert.match(text, /IT ALSO SUPPORTS these goals/)
    assert.ok(text.includes(`- ${gst.title}: ${gst.keyMessage}`))
    assert.ok(text.includes(close.keyMessage!))
    assert.ok(text.includes(`Steer the reader toward: ${close.desiredAction}`))
    assert.ok(text.includes(close.targetUrl!))
    assert.ok(!text.includes(hiring.keyMessage!))
  })

  it("counts every one of its goals' messages as the author's own words", () => {
    const ctx = withIdeaGoal(context([close, hiring, gst]), both)
    const sources = collectFigureSources(ctx, both)
    assert.ok(sources.includes(gst.keyMessage!))
    assert.ok(!sources.includes(hiring.keyMessage!))
  })

  it('drops another goal deleted since, and keeps a deleted main goal from its copy', () => {
    const goneOther = withIdeaGoal(
      context([close, gst]),
      idea({ goalId: close.id, goalIds: [close.id, 'deleted-goal'] })
    )
    assert.deepStrictEqual(goneOther.selectedGoals.map(g => g.id), [close.id])

    const goneMain = withIdeaGoal(
      context([close, gst]),
      idea({
        goalId: null,
        goalIds: ['deleted-main', gst.id],
        goalSnapshot: snapshotGoal({ ...hiring, id: 'deleted-main' })
      })
    )
    assert.deepStrictEqual(
      goneMain.selectedGoals.map(g => g.title),
      [hiring.title, gst.title]
    )
    assert.strictEqual(goneMain.primaryGoal?.title, hiring.title)
  })

  it('lists its goals on the card, main first', () => {
    const goals = [close, gst]
    assert.deepStrictEqual(ideaGoalTitles(both, goals), [close.title, gst.title])
    // Made before ideas could serve several goals.
    assert.deepStrictEqual(
      ideaGoalTitles({ goalId: close.id, goalIds: [], goalSnapshot: null }, goals),
      [close.title]
    )
    // The main goal deleted: its kept title; another deleted goal is left out.
    assert.deepStrictEqual(
      ideaGoalTitles(
        {
          goalId: null,
          goalIds: ['gone', 'also-gone', gst.id],
          goalSnapshot: snapshotGoal({ ...hiring, id: 'gone' })
        },
        goals
      ),
      [hiring.title, gst.title]
    )
  })
})
