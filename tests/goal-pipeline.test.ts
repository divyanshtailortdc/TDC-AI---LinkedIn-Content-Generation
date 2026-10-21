import { and, eq } from 'drizzle-orm'
import assert from 'node:assert'
import { after, before, describe, it } from 'node:test'

/**
 * The whole path, end to end: an identity with four goals runs ideation for
 * one goal, then for three, then a reviewer approves and selects ideas and
 * posts are drafted. The model and web search are stubbed at `fetch`, so it
 * costs nothing and every request they receive is checked: goals that were not
 * picked never reach them, every picked goal ends up leading an idea (with one
 * retry when the first batch leaves a goal out), an idea can serve more than
 * one goal, and only selected, approved ideas are drafted.
 *
 * Opt-in, and only ever against a throwaway database (migrated, with
 * pgvector). It never falls back to .env, whose database is shared:
 *
 *   PIPELINE_TEST_DATABASE_URL=postgres://… \
 *     npx tsx --conditions=react-server --test tests/goal-pipeline.test.ts
 */
const url = process.env.PIPELINE_TEST_DATABASE_URL

type Sent = { system: string; prompt: string }

/** Unrelated subjects, so no two stub ideas look alike to novelty or diversity checks. */
const SUBJECTS = [
  'Reconciling bank feeds daily keeps month-end small for growing brands.',
  'Marketplace payouts arrive net of fees, so matching them needs a settlement ledger.',
  'Expense approvals that wait until quarter close delay every downstream report.',
  'Freight and courier invoices are where brands forget input credit.',
  'Vendors who upload invoices late break the credit chain for their buyers.',
  'Warehouse shrinkage hides inside cycle counts nobody reconciles against purchase orders.',
  'Subscription refunds booked as negative revenue distort retention dashboards.',
  'Founders reading profit before cash flow misjudge runway during seasonal dips.',
  'Contractor classification decides withholding obligations long before tax season.',
  'Gift card liabilities sit forgotten on balance sheets until auditors arrive.',
  'Duplicate supplier records quietly double payments across procurement systems.',
  'Currency conversion spreads erode margins on international wholesale orders.',
  'Payroll mistakes usually begin with timesheets approved without review.',
  'Chargeback disputes cost more in staff hours than the disputed amounts.',
  'Inventory valuation methods change reported margins without changing actual sales.',
  'Board decks built from spreadsheets drift from the ledger within weeks.',
  'Discount codes stacked at checkout erode contribution margin unnoticed.',
  'Return shipping labels belong in cost of goods, not marketing budgets.',
  'Accrual journals posted twice survive because nobody owns the reversal.',
  'Loan covenants depend on ratios that bookkeeping shortcuts silently distort.',
  'Customs duties paid by couriers reappear months later as surprise invoices.',
  'Prepaid annual software licences need monthly amortisation, not one lump expense.',
  'Influencer barter deals carry taxable value that rarely reaches the books.',
  'Petty cash habits from small shops collapse once teams spread across cities.'
]

const ANGLES = [
  'process_breakdown', 'common_misconception', 'failure_postmortem', 'tradeoff_analysis',
  'first_principles', 'practitioner_lesson', 'decision_framework', 'comparison',
  'contrarian_take', 'prediction', 'trend_interpretation', 'belief_shift'
] as const

describe('picking goals and ideas controls what is generated', { skip: !url }, () => {
  const sent: { ideation: Sent[]; drafting: Sent[]; searches: string[] } = {
    ideation: [],
    drafting: [],
    searches: []
  }
  /**
   * How the stub answers ideation: `fails` lists goal labels whose ideas it
   * writes with an unsourced figure, so the grounding checks drop them;
   * `failRetry` keeps doing so on the retry; `alsoServes` adds a second goal
   * to the first idea.
   */
  let scenario: { fails: string[]; failRetry: boolean; alsoServes?: string } = {
    fails: [],
    failRetry: false
  }
  let subject = 0
  const realFetch = globalThis.fetch
  let m: {
    db: typeof import('../src/db').db
    schema: typeof import('../src/db/schema')
    queue: typeof import('../src/jobs/queue')
    ideation: typeof import('../src/lib/ai/pipeline/ideation-run')
    drafting: typeof import('../src/lib/ai/pipeline/drafting-run')
    selection: typeof import('../src/lib/ai/pipeline/draft-selection')
  }
  const ids = { account: '', other: '', close: '', hiring: '', gst: '', paused: '', foreign: '' }
  const runs = { single: '', multi: '', stubborn: '' }

  function ideationOutput(prompt: string) {
    const isRetry = prompt.includes('ALREADY PROPOSED IN THIS RUN')
    const labels = /Assign goals in this distribution \(one per idea, in order\): ([^\\]+)/
      .exec(prompt)![1]!
      .split(' | ')
      .map(l => l.trim())
    return {
      ideas: labels.map((label, i) => {
        const thesis = SUBJECTS[subject++ % SUBJECTS.length]!
        const fail = scenario.fails.includes(label) && (!isRetry || scenario.failRetry)
        const title = thesis.split(' ').slice(0, 5).join(' ')
        return {
          title,
          thesis,
          perspectiveAngle: ANGLES[i % ANGLES.length],
          angle: title,
          goalRefs: i === 0 && scenario.alsoServes ? [label, scenario.alsoServes] : [label],
          audienceRef: '',
          format: 'thought_leadership',
          whyNow: 'Growing brands keep running into this at every close.',
          hookConcept: `${title}: the part most founders skip.`,
          // An unsourced figure: the guard drops the idea.
          coreArgument: fail ? `${thesis} Teams lose 73% of the value here.` : thesis,
          audienceTakeaway: 'Change one habit before the next close.',
          supportingEvidence: [],
          noveltyNote: 'Names the mechanism instead of repeating generic advice about it.',
          estimatedStrength: 90 - i,
          risks: []
        }
      })
    }
  }

  function draftOutput() {
    return {
      hook: 'Month-end runs late because the other days were skipped.',
      body: 'Most close delays start weeks earlier.\n\nWhen bank feeds wait for the last week, every mismatch piles up at once. Reconciling a little each day keeps the final step small.\n\nThe habit matters more than the tool.',
      cta: 'Which account do you reconcile last?',
      firstComment: '',
      hashtags: ['Bookkeeping', 'Finance'],
      alternateHooks: ['Close starts on day one.', 'The last week of the month is not when close happens.'],
      selfScores: { hookStrength: 7, onBrand: 7, clarity: 8, evidenceGrounding: 7, originality: 7 },
      selfFlags: []
    }
  }

  before(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      SKIP_ENV_VALIDATION: 'true',
      ANTHROPIC_API_KEY: 'test-key',
      SERPER_API_KEY: 'test-key',
      RESEARCH_MODE: 'fixed'
    })
    // Only the stub below may answer: no gateway, and no proxy in front of the API.
    delete process.env.AI_GATEWAY_API_KEY
    delete process.env.ANTHROPIC_BASE_URL

    globalThis.fetch = async (input, init) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const body = JSON.parse(String(init?.body ?? '{}'))
      if (href.startsWith('https://google.serper.dev/')) {
        sent.searches.push(body.q)
        return Response.json({ organic: [] })
      }
      if (href.startsWith('https://api.anthropic.com/')) {
        const system = JSON.stringify(body.system ?? '')
        const prompt = JSON.stringify(body.messages ?? [])
        const isIdeation = system.includes('editorial strategist')
        ;(isIdeation ? sent.ideation : sent.drafting).push({ system, prompt })
        const output = isIdeation ? ideationOutput(prompt) : draftOutput()
        return Response.json({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [{ type: 'text', text: JSON.stringify(output) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 }
        })
      }
      throw new Error(`Unexpected request in the pipeline test: ${href}`)
    }

    try {
      m = {
        db: (await import('../src/db')).db,
        schema: await import('../src/db/schema'),
        queue: await import('../src/jobs/queue'),
        ideation: await import('../src/lib/ai/pipeline/ideation-run'),
        drafting: await import('../src/lib/ai/pipeline/drafting-run'),
        selection: await import('../src/lib/ai/pipeline/draft-selection')
      }
    } catch (err) {
      throw new Error(
        `Could not load the pipeline. Run with --conditions=react-server. (${(err as Error).message})`
      )
    }

    const { db, schema } = m
    const tag = `qa-goals-${Date.now().toString(36)}`
    const account = async (suffix: string) =>
      (
        await db
          .insert(schema.accountsTable)
          .values({
            name: 'Ledgerly',
            handle: `${tag}-${suffix}`,
            headline: 'Bookkeeping for D2C brands',
            accountType: 'company',
            industry: 'Accounting'
          })
          .returning()
      )[0]!.id
    ids.account = await account('a')
    ids.other = await account('b')

    const goal = async (accountId: string, values: Record<string, unknown>) =>
      (
        await db
          .insert(schema.goalsTable)
          .values({ accountId, title: 'Goal', ...values })
          .returning()
      )[0]!.id
    ids.close = await goal(ids.account, {
      title: 'Faster month-end close',
      keyMessage: 'Daily reconciliation keeps month-end small.',
      desiredAction: 'Book a close review',
      targetUrl: 'https://ledgerly.example/close-review',
      linkStrategy: 'body'
    })
    ids.gst = await goal(ids.account, {
      title: 'Explain input tax credit',
      keyMessage: 'Most D2C founders leave input tax credit unclaimed.'
    })
    ids.hiring = await goal(ids.account, {
      title: 'Hire senior accountants',
      keyMessage: 'Accountants join teams that give them modern tooling.',
      targetUrl: 'https://ledgerly.example/careers'
    })
    ids.paused = await goal(ids.account, { title: 'Paused goal', isActive: false })
    ids.foreign = await goal(ids.other, { title: 'Someone else' })
  })

  after(async () => {
    globalThis.fetch = realFetch
    if (m) {
      for (const id of [ids.account, ids.other].filter(Boolean)) {
        await m.db.delete(m.schema.accountsTable).where(eq(m.schema.accountsTable.id, id))
      }
    }
    // The connection would keep the test process alive.
    setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref()
  })

  /** Queues a run for `goalIds` and carries it through ideation; returns what it sent. */
  async function runFor(goalIds: string[]) {
    const before = { ideation: sent.ideation.length, searches: sent.searches.length }
    const { run } = await m.queue.enqueueRun({ accountId: ids.account, goalIds })
    assert.ok(run)
    assert.deepStrictEqual(run.goalIds, goalIds)
    assert.ok(await m.queue.claimRunById(run.id))
    const result = await m.ideation.executeResearchAndIdeate(run.id)
    assert.strictEqual(result.status, 'awaiting_idea_approval')
    const ideas = await m.db
      .select()
      .from(m.schema.ideasTable)
      .where(eq(m.schema.ideasTable.runId, run.id))
    const steps = await m.db
      .select()
      .from(m.schema.runStepsTable)
      .where(eq(m.schema.runStepsTable.runId, run.id))
    return {
      run,
      ideas,
      ideation: steps.find(s => s.stage === 'generating_ideas')!.responseJson,
      context: steps.find(s => s.stage === 'gathering_context')!.responseJson,
      calls: sent.ideation.slice(before.ideation),
      searches: sent.searches.slice(before.searches)
    }
  }

  const leaks = (text: string, phrases: string[]) => phrases.filter(p => text.includes(p))

  it('refuses a run without a goal it may use', async () => {
    const { enqueueRun } = m.queue
    await assert.rejects(enqueueRun({ accountId: ids.account, goalIds: [] }), /at least one goal/)
    await assert.rejects(enqueueRun({ accountId: ids.account, goalIds: [ids.paused] }), /is paused/)
    await assert.rejects(enqueueRun({ accountId: ids.account, goalIds: [ids.foreign] }), /Goal not found/)
  })

  it('a single-goal run writes every idea for that goal and sees no other', async () => {
    scenario = { fails: [], failRetry: false }
    const result = await runFor([ids.gst])
    runs.single = result.run.id

    assert.strictEqual(result.calls.length, 1, 'one ideation call, no retry')
    const { system, prompt } = result.calls[0]!
    assert.ok(system.includes('[G1] Explain input tax credit'))
    assert.ok(!system.includes('[G2]'))
    assert.deepStrictEqual(
      leaks(`${system}${prompt}`, ['Faster month-end close', 'Hire senior accountants', 'modern tooling', 'Paused goal', 'Someone else']),
      []
    )
    assert.match(prompt, /G1 \| G1 \| G1/)
    assert.ok(result.searches.some(q => q.includes('Explain input tax credit')), result.searches.join(' | '))
    assert.ok(!result.searches.some(q => /close|hire|accountants/i.test(q)), result.searches.join(' | '))

    assert.strictEqual(result.ideas.length, 5)
    for (const idea of result.ideas) {
      assert.strictEqual(idea.goalId, ids.gst)
      assert.deepStrictEqual(idea.goalIds, [ids.gst])
      assert.strictEqual(idea.goalSnapshot?.title, 'Explain input tax credit')
    }
    assert.deepStrictEqual(result.context.goals, ['Explain input tax credit'])
    assert.deepStrictEqual(result.ideation.uncoveredGoals, [])
  })

  it('a three-goal run covers every goal, retrying for one the first batch missed', async () => {
    // Every first-batch idea for G3 (hiring) fails grounding; the retry succeeds.
    // The first idea (for G1, the close goal) also serves G2.
    scenario = { fails: ['G3'], failRetry: false, alsoServes: 'G2' }
    const result = await runFor([ids.close, ids.gst, ids.hiring])
    runs.multi = result.run.id

    // Research searched for each goal; the model was briefed on all three.
    for (const title of ['Faster month-end close', 'Explain input tax credit', 'Hire senior accountants']) {
      assert.ok(result.searches.some(q => q.includes(title)), `${title}: ${result.searches.join(' | ')}`)
    }
    const first = result.calls[0]!
    assert.ok(first.system.includes('[G1] Faster month-end close'))
    assert.ok(first.system.includes('[G2] Explain input tax credit'))
    assert.ok(first.system.includes('[G3] Hire senior accountants'))
    assert.ok(!first.system.includes('Paused goal'))

    // One retry, asking only for the goal left out.
    assert.strictEqual(result.calls.length, 2)
    assert.match(result.calls[1]!.prompt, /distribution \(one per idea, in order\): G3 \| G3\\n/)
    assert.strictEqual(result.ideation.retriedForGoals, true)

    // Every goal leads at least one idea, within the usual five.
    assert.strictEqual(result.ideas.length, 5)
    for (const goalId of [ids.close, ids.gst, ids.hiring]) {
      assert.ok(result.ideas.some(i => i.goalId === goalId), goalId)
    }
    assert.deepStrictEqual(result.ideation.uncoveredGoals, [])

    // The idea written for the close goal that also moves the credit goal keeps both.
    const both = result.ideas.find(i => i.goalIds.length === 2)
    assert.ok(both, JSON.stringify(result.ideas.map(i => i.goalIds)))
    assert.deepStrictEqual(both.goalIds, [ids.close, ids.gst])
    assert.strictEqual(both.goalId, ids.close)
    for (const idea of result.ideas) {
      assert.ok(idea.goalIds.every(id => [ids.close, ids.gst, ids.hiring].includes(id)))
      assert.strictEqual(idea.goalIds[0], idea.goalId)
    }
  })

  it('reports a goal that stays uncovered after the retry, with why', async () => {
    scenario = { fails: ['G2'], failRetry: true }
    const result = await runFor([ids.close, ids.hiring])
    runs.stubborn = result.run.id
    assert.strictEqual(result.calls.length, 2)
    assert.ok(result.ideas.length > 0)
    assert.ok(!result.ideas.some(i => i.goalIds.includes(ids.hiring)))
    assert.strictEqual(result.ideation.uncoveredGoals.length, 1)
    const [uncovered] = result.ideation.uncoveredGoals
    assert.strictEqual(uncovered.goal, 'Hire senior accountants')
    assert.match(uncovered.reason, /did not pass the checks.*"73%"/)
  })

  it('drafts only selected approved ideas, each briefed with its own goals', async () => {
    const { db, schema } = m
    const ideas = await db.select().from(schema.ideasTable).where(eq(schema.ideasTable.runId, runs.multi))
    const both = ideas.find(i => i.goalIds.length === 2)!
    const gstIdea = ideas.find(i => i.goalId === ids.gst)!
    const unselected = ideas.find(i => i.id !== both.id && i.id !== gstIdea.id)!

    // Two approved; one of them and a still-proposed idea are selected.
    await db
      .update(schema.ideasTable)
      .set({ status: 'approved' })
      .where(and(eq(schema.ideasTable.runId, runs.multi), eq(schema.ideasTable.id, both.id)))
    await db
      .update(schema.ideasTable)
      .set({ status: 'approved' })
      .where(eq(schema.ideasTable.id, unselected.id))

    const before = sent.drafting.length
    const outcome = await m.selection.draftSelection(
      db,
      { accountId: ids.account, ideaIds: [both.id, gstIdea.id], runId: runs.multi },
      { draft: m.drafting.executeDraftingForIdea, settleRun: m.drafting.settleRunAfterDrafting }
    )
    assert.deepStrictEqual(outcome, { drafted: 1, notApproved: 1, alreadyDrafted: 0, notFound: 0 })

    const posts = await db.select().from(schema.postDraftsTable).where(eq(schema.postDraftsTable.accountId, ids.account))
    assert.deepStrictEqual(posts.map(p => p.ideaId), [both.id])
    const after = await db.select().from(schema.ideasTable).where(eq(schema.ideasTable.runId, runs.multi))
    const status = (id: string) => after.find(i => i.id === id)!.status
    assert.strictEqual(status(both.id), 'drafted')
    assert.strictEqual(status(unselected.id), 'approved')
    assert.strictEqual(status(gstIdea.id), 'proposed')

    // The post's main goal sets its ask and link; its second goal is reinforced.
    const drafts = sent.drafting.slice(before)
    assert.ok(drafts.length >= 1)
    for (const { system, prompt } of drafts) {
      const text = `${system}${prompt}`
      assert.ok(text.includes(both.title!))
      assert.ok(text.includes('Daily reconciliation keeps month-end small.'))
      assert.ok(text.includes('https://ledgerly.example/close-review'))
      assert.ok(text.includes('IT ALSO SUPPORTS these goals'))
      assert.ok(text.includes('Explain input tax credit: Most D2C founders leave input tax credit unclaimed.'))
      assert.deepStrictEqual(leaks(text, ['modern tooling', 'careers']), [])
    }
  })

  it('a selection from another identity drafts nothing', async () => {
    const before = sent.drafting.length
    const ideas = await m.db.select().from(m.schema.ideasTable).where(eq(m.schema.ideasTable.runId, runs.multi))
    const approved = ideas.filter(i => i.status === 'approved').map(i => i.id)
    const outcome = await m.selection.draftSelection(
      m.db,
      { accountId: ids.other, ideaIds: approved },
      { draft: m.drafting.executeDraftingForIdea, settleRun: m.drafting.settleRunAfterDrafting }
    )
    assert.strictEqual(outcome.drafted, 0)
    assert.strictEqual(outcome.notFound, approved.length)
    assert.strictEqual(sent.drafting.length, before)
  })
})
