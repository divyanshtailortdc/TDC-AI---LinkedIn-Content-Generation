import assert from 'node:assert'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import { recordReviewMediaSpendIn } from '../src/lib/ai/review-spend'
import { EMPTY_USAGE, type CallUsage } from '../src/lib/ai/usage'

// Runs against the local development database; every row it makes is removed.
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]

const usage = (calls: number, costUsd: number): CallUsage => ({
  ...EMPTY_USAGE,
  calls,
  costUsd,
  billedCalls: calls
})

describe('image spend while reviewing a post is charged to its run', { skip: !url }, () => {
  const client = postgres(url!, { max: 2, prepare: false })
  const database = drizzle(client, { schema })
  const handle = `qa-spend-${Date.now().toString(36)}`
  let runId = ''
  let draftId = ''
  let orphanDraftId = ''

  const runCost = async () =>
    Number((await client`select cost_usd from runs where id = ${runId}`)[0]!.cost_usd)
  const steps = () =>
    client`select stage, status, cost_usd, error, request_summary from run_steps where run_id = ${runId} order by created_at`

  before(async () => {
    const [account] = await database
      .insert(schema.accountsTable)
      .values({ name: 'QA Spend', accountType: 'personal', handle, headline: 'QA', bio: 'QA', industry: 'Finance' })
      .returning()
    const [run] = await database
      .insert(schema.runsTable)
      .values({ accountId: account!.id, workflow: 'standard', trigger: 'manual', status: 'completed' })
      .returning()
    runId = run!.id
    const [idea] = await database
      .insert(schema.ideasTable)
      .values({ accountId: account!.id, runId, title: 'i', thesis: 't', hook: 'h', angle: 'a', status: 'drafted' } as never)
      .returning()
    const draftValues = { accountId: account!.id, hook: 'h', originalHook: 'h', body: 'b', originalBody: 'b', format: 'thought_leadership', charCount: 3 }
    const [draft] = await database.insert(schema.postDraftsTable).values({ ...draftValues, ideaId: idea!.id } as never).returning()
    draftId = draft!.id
    const [orphan] = await database.insert(schema.postDraftsTable).values(draftValues as never).returning()
    orphanDraftId = orphan!.id
    // What the run already cost when its posts were drafted.
    await database.insert(schema.runStepsTable).values({
      runId,
      stage: 'drafting',
      status: 'completed',
      costUsd: '0.5000',
      responseJson: { usage: usage(1, 0.5) }
    } as never)
    await client`update runs set cost_usd = 0.5 where id = ${runId}`
  })
  after(async () => {
    await client`delete from accounts where handle = ${handle}`
    await client.end()
  })

  it('an image made during review adds to the run\'s cost', async () => {
    assert.equal(await runCost(), 0.5)
    const recorded = await recordReviewMediaSpendIn(database, draftId, usage(1, 0.04), {
      summary: 'Image from reviewer prompt (post review)'
    })
    assert.equal(recorded, true)
    assert.ok(Math.abs((await runCost()) - 0.54) < 1e-9)
    const media = (await steps()).filter(s => s.stage === 'media')
    assert.equal(media.length, 1)
    assert.equal(media[0]!.status, 'completed')
  })

  it('a failed or cancelled attempt is billed too, and recorded as failed', async () => {
    await recordReviewMediaSpendIn(database, draftId, usage(2, 0.08), {
      summary: 'Image from reviewer prompt (post review)',
      error: 'Image generation was stopped.'
    })
    assert.ok(Math.abs((await runCost()) - 0.62) < 1e-9)
    const failed = (await steps()).filter(s => s.stage === 'media' && s.status === 'failed')
    assert.equal(failed.length, 1)
    assert.equal(failed[0]!.error, 'Image generation was stopped.')
  })

  it('nothing is recorded when nothing was billed', async () => {
    const before = (await steps()).length
    assert.equal(await recordReviewMediaSpendIn(database, draftId, EMPTY_USAGE, { summary: 'x' }), false)
    assert.equal(await recordReviewMediaSpendIn(database, draftId, undefined, { summary: 'x' }), false)
    assert.equal((await steps()).length, before)
  })

  it('a post with no run has nothing to charge, and does not fail', async () => {
    assert.equal(await recordReviewMediaSpendIn(database, orphanDraftId, usage(1, 0.04), { summary: 'x' }), false)
  })

  it('the run\'s token totals follow its steps', async () => {
    const [run] = await database.select().from(schema.runsTable).where(eq(schema.runsTable.id, runId))
    assert.equal((run!.tokenCounts as CallUsage).calls, 4) // 1 draft + 1 + 2 media calls
  })
})
