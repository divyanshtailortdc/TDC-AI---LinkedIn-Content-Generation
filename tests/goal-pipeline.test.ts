import { and, eq } from 'drizzle-orm'
import assert from 'node:assert'
import { after, before, describe, it } from 'node:test'

/**
 * The whole path, end to end: an identity with four goals starts a run for
 * two of them, research and ideation run, a reviewer approves some ideas and
 * selects some, and posts are drafted. The model and web search are stubbed at
 * `fetch`, so it costs nothing and every request they receive is checked: the
 * goals that were not picked must not reach them, and only selected, approved
 * ideas may be drafted.
 *
 * Opt-in, and only ever against a throwaway database (migrated, with
 * pgvector). It never falls back to .env, whose database is shared:
 *
 *   PIPELINE_TEST_DATABASE_URL=postgres://… \
 *     npx tsx --conditions=react-server --test tests/goal-pipeline.test.ts
 */
const url = process.env.PIPELINE_TEST_DATABASE_URL

type Sent = { system: string; prompt: string }

const IDEAS = [
  ['G1', 'Close is a daily habit', 'Reconciling bank feeds every day keeps month-end small for growing brands.'],
  ['G2', 'Input credit needs invoice discipline', 'Claiming input credit depends on vendors filing their invoices correctly.'],
  ['G1', 'Marketplace payouts break reconciliation', 'Marketplace payouts arrive net of fees, so matching them needs a settlement ledger.'],
  ['G2', 'Unclaimed credit hides in freight bills', 'Freight and courier invoices are where brands most often forget input credit.'],
  ['G1', 'Approvals stall the close', 'Expense approvals that wait for month-end push the close later than any software gap.'],
  // Points at a goal the run does not have, so it must be turned away.
  ['G3', 'Accountants want modern tooling', 'Good accountants choose employers by the tools they get to use.']
] as const

function ideationOutput() {
  return {
    ideas: IDEAS.map(([goalRef, title, thesis], i) => ({
      title,
      thesis,
      perspectiveAngle: (['process_breakdown', 'common_misconception', 'failure_postmortem', 'tradeoff_analysis', 'first_principles', 'practitioner_lesson'] as const)[i],
      angle: title,
      goalRef,
      audienceRef: '',
      format: 'thought_leadership',
      whyNow: 'Growing brands keep running into this at every close.',
      hookConcept: `${title}: the part most founders skip.`,
      coreArgument: thesis,
      audienceTakeaway: 'Change one habit before the next close.',
      supportingEvidence: [],
      noveltyNote: 'Names the mechanism instead of repeating generic advice about it.',
      estimatedStrength: 90 - i,
      risks: []
    }))
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

describe('picking goals and ideas controls what is generated', { skip: !url }, () => {
  const sent: { ideation: Sent[]; drafting: Sent[]; searches: string[] } = {
    ideation: [],
    drafting: [],
    searches: []
  }
  const realFetch = globalThis.fetch
  let m: {
    db: typeof import('../src/db').db
    schema: typeof import('../src/db/schema')
    queue: typeof import('../src/jobs/queue')
    ideation: typeof import('../src/lib/ai/pipeline/ideation-run')
    drafting: typeof import('../src/lib/ai/pipeline/drafting-run')
    selection: typeof import('../src/lib/ai/pipeline/draft-selection')
  }
  const ids = { account: '', other: '', close: '', hiring: '', gst: '', paused: '', foreign: '', run: '' }

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
        const output = isIdeation ? ideationOutput() : draftOutput()
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
    ids.hiring = await goal(ids.account, {
      title: 'Hire senior accountants',
      keyMessage: 'Accountants join teams that give them modern tooling.',
      targetUrl: 'https://ledgerly.example/careers'
    })
    ids.gst = await goal(ids.account, {
      title: 'Explain input tax credit',
      keyMessage: 'Most D2C founders leave input tax credit unclaimed.'
    })
    ids.paused = await goal(ids.account, { title: 'Paused goal', isActive: false })
    ids.foreign = await goal(ids.other, { title: 'Someone else' })
  })

  after(async () => {
    globalThis.fetch = realFetch
    if (m && ids.account) {
      await m.db
        .delete(m.schema.accountsTable)
        .where(eq(m.schema.accountsTable.handle, (await m.db.query.accountsTable.findFirst({ where: eq(m.schema.accountsTable.id, ids.account) }))!.handle))
      await m.db.delete(m.schema.accountsTable).where(eq(m.schema.accountsTable.id, ids.other))
    }
    // The connection would keep the test process alive.
    setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref()
  })

  it('refuses a run without a goal it may use', async () => {
    const { enqueueRun } = m.queue
    await assert.rejects(enqueueRun({ accountId: ids.account, goalIds: [] }), /at least one goal/)
    await assert.rejects(enqueueRun({ accountId: ids.account, goalIds: [ids.paused] }), /is paused/)
    await assert.rejects(enqueueRun({ accountId: ids.account, goalIds: [ids.foreign] }), /Goal not found/)
  })

  it('runs research and ideation for the picked goals only', async () => {
    const { run } = await m.queue.enqueueRun({
      accountId: ids.account,
      goalIds: [ids.close, ids.gst]
    })
    assert.ok(run)
    ids.run = run.id
    assert.deepStrictEqual(run.goalIds, [ids.close, ids.gst])
    assert.strictEqual(run.goalId, ids.close)

    assert.ok(await m.queue.claimRunById(run.id))
    const result = await m.ideation.executeResearchAndIdeate(run.id)
    assert.strictEqual(result.status, 'awaiting_idea_approval')

    // Web research searched for the picked goals, never the hiring goal.
    assert.ok(sent.searches.some(q => q.includes('Faster month-end close')), sent.searches.join(' | '))
    assert.ok(sent.searches.some(q => q.includes('Explain input tax credit')), sent.searches.join(' | '))
    assert.ok(!sent.searches.some(q => /hire|accountants|Paused/i.test(q)), sent.searches.join(' | '))

    // The model was briefed on the picked goals and nothing else.
    assert.strictEqual(sent.ideation.length, 1)
    const { system, prompt } = sent.ideation[0]!
    assert.ok(system.includes('[G1] Faster month-end close'))
    assert.ok(system.includes('[G2] Explain input tax credit'))
    for (const leak of ['Hire senior accountants', 'modern tooling', 'careers', 'Paused goal', 'Someone else']) {
      assert.ok(!`${system}${prompt}`.includes(leak), leak)
    }
    assert.match(prompt, /G1 \| G2 \| G1 \| G2/)
    assert.doesNotMatch(`${system}${prompt}`, /pillar/i)
  })

  it('saves every idea under the picked goal it serves, and drops the rest', async () => {
    const { db, schema } = m
    const ideas = await db.select().from(schema.ideasTable).where(eq(schema.ideasTable.runId, ids.run))
    assert.ok(ideas.length >= 2, `${ideas.length} ideas`)
    for (const idea of ideas) {
      assert.ok([ids.close, ids.gst].includes(idea.goalId!), idea.title ?? '')
      assert.strictEqual(idea.goalSnapshot?.title, idea.goalId === ids.close ? 'Faster month-end close' : 'Explain input tax credit')
      assert.strictEqual(idea.pillar, null)
    }
    // Both goals got ideas, and the idea for a goal outside the run was not kept.
    assert.ok(ideas.some(i => i.goalId === ids.close))
    assert.ok(ideas.some(i => i.goalId === ids.gst))
    assert.ok(!ideas.some(i => i.title === 'Accountants want modern tooling'))

    const steps = await db.select().from(schema.runStepsTable).where(eq(schema.runStepsTable.runId, ids.run))
    const context = steps.find(s => s.stage === 'gathering_context')!
    assert.deepStrictEqual(context.responseJson.goals, ['Faster month-end close', 'Explain input tax credit'])
    const ideation = steps.find(s => s.stage === 'generating_ideas')!
    assert.ok(
      ideation.responseJson.discarded.some(
        (d: { title: string; reason: string }) =>
          d.title === 'Accountants want modern tooling' && /none of the goals selected/.test(d.reason)
      ),
      JSON.stringify(ideation.responseJson.discarded)
    )
  })

  it('drafts only the selected ideas that are approved, each for its own goal', async () => {
    const { db, schema } = m
    const ideas = await db.select().from(schema.ideasTable).where(eq(schema.ideasTable.runId, ids.run))
    const closeIdeas = ideas.filter(i => i.goalId === ids.close)
    const gstIdea = ideas.find(i => i.goalId === ids.gst)!
    assert.ok(closeIdeas.length >= 2)
    const [selectedApproved, unselectedApproved] = closeIdeas

    // Two approved; one of them, and the still-proposed tax idea, are selected.
    await db
      .update(schema.ideasTable)
      .set({ status: 'approved' })
      .where(and(eq(schema.ideasTable.runId, ids.run), eq(schema.ideasTable.goalId, ids.close)))

    const outcome = await m.selection.draftSelection(
      db,
      { accountId: ids.account, ideaIds: [selectedApproved!.id, gstIdea.id], runId: ids.run },
      { draft: m.drafting.executeDraftingForIdea, settleRun: m.drafting.settleRunAfterDrafting }
    )
    assert.deepStrictEqual(outcome, { drafted: 1, notApproved: 1, alreadyDrafted: 0, notFound: 0 })

    const posts = await db.select().from(schema.postDraftsTable).where(eq(schema.postDraftsTable.accountId, ids.account))
    assert.deepStrictEqual(posts.map(p => p.ideaId), [selectedApproved!.id])
    const after = await db.select().from(schema.ideasTable).where(eq(schema.ideasTable.runId, ids.run))
    const status = (id: string) => after.find(i => i.id === id)!.status
    assert.strictEqual(status(selectedApproved!.id), 'drafted')
    assert.strictEqual(status(unselectedApproved!.id), 'approved')
    assert.strictEqual(status(gstIdea.id), 'proposed')

    // Every drafting call was for that idea, briefed with its own goal.
    assert.ok(sent.drafting.length >= 1)
    for (const { system, prompt } of sent.drafting) {
      const text = `${system}${prompt}`
      assert.ok(text.includes(selectedApproved!.title!))
      assert.ok(text.includes('Daily reconciliation keeps month-end small.'))
      assert.ok(text.includes('https://ledgerly.example/close-review'))
      for (const leak of ['Most D2C founders leave input tax credit unclaimed.', 'modern tooling', 'careers']) {
        assert.ok(!text.includes(leak), leak)
      }
    }
  })

  it('a selection from another identity drafts nothing', async () => {
    const before = sent.drafting.length
    const ideas = await m.db.select().from(m.schema.ideasTable).where(eq(m.schema.ideasTable.runId, ids.run))
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
