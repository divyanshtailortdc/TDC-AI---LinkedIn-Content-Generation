import { asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { after, describe, it } from 'node:test'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import {
  accountOwnerIn,
  accountUsageIn,
  recordUsageIn,
  spentInWindowIn,
  type SpendCharge
} from '../src/lib/ai/spend-ledger'
import {
  EMPTY_USAGE,
  readEmbeddingUsage,
  type CallUsage
} from '../src/lib/ai/usage'

describe('embedding spend', () => {
  it('is priced from the tokens of every request, not the gateway figure', () => {
    // The SDK merges the metadata of the requests it split the values into,
    // so the gateway's cost is that of the last one only.
    const result = {
      usage: { tokens: 2_000_000 },
      providerMetadata: { gateway: { cost: '0.0001' } }
    }
    const usage = readEmbeddingUsage(result, 'openai/text-embedding-3-small')
    assert.strictEqual(usage.calls, 1)
    assert.strictEqual(usage.inputTokens, 2_000_000)
    assert.strictEqual(usage.totalTokens, 2_000_000)
    assert.strictEqual(usage.costUsd, 0.04)
    assert.strictEqual(usage.estimatedCalls, 1)
  })

  it('counts a model with no known price, and tokens it did not report, as free', () => {
    const usage = readEmbeddingUsage(
      { usage: { tokens: Number.NaN } },
      'other/embedder'
    )
    assert.strictEqual(usage.calls, 1)
    assert.strictEqual(usage.inputTokens, 0)
    assert.strictEqual(usage.costUsd, 0)
  })
})

// Runs against the local development database, inside transactions that are
// always rolled back: nothing a test writes stays. Each applies migration
// 0053 first, so it works whether or not that database has it yet.
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]

const migration = fs
  .readFileSync('src/db/migrations/0053_ai_usage.sql', 'utf8')
  .split('--> statement-breakpoint')
  .map(statement => statement.trim())
  .filter(Boolean)
const backfill = migration.at(-1)!
const ddl = migration.slice(0, -1)

const usage = (costUsd: number, more: Partial<CallUsage> = {}): CallUsage => ({
  ...EMPTY_USAGE,
  calls: 1,
  costUsd,
  billedCalls: 1,
  ...more
})

describe('the usage ledger', { skip: !url }, () => {
  const client = postgres(url!, { max: 2, prepare: false, onnotice: () => {} })
  const database = drizzle(client, { schema })
  const tag = `qa-ledger-${Date.now().toString(36)}`
  let made = 0
  after(() => client.end())

  type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0]
  const ROLLBACK = new Error('rolled back on purpose')

  async function inRolledBack(check: (tx: Tx) => Promise<void>) {
    await database
      .transaction(async tx => {
        for (const statement of ddl) await tx.execute(sql.raw(statement))
        await check(tx)
        throw ROLLBACK
      })
      .catch(err => {
        if (err !== ROLLBACK) throw err
      })
  }

  async function user(tx: Tx) {
    const [row] = await tx
      .insert(schema.authUsersTable)
      .values({ name: 'QA Ledger', email: `${tag}-${++made}@example.test` })
      .returning({ id: schema.authUsersTable.id })
    return row!.id
  }

  async function identity(tx: Tx, userId: string | null) {
    const [row] = await tx
      .insert(schema.accountsTable)
      .values({
        userId,
        name: 'QA Ledger',
        handle: `${tag}-${++made}`,
        headline: 'QA'
      })
      .returning({ id: schema.accountsTable.id })
    return row!.id
  }

  const charge = (c: Partial<SpendCharge>): SpendCharge => ({
    source: 'runs',
    userId: null,
    accountId: null,
    runId: null,
    ...c
  })
  const call = (u: CallUsage, stage = 'drafting') => ({
    stage,
    modelId: 'anthropic/claude-sonnet-5-5',
    usage: u
  })

  it('starts out with the billed run steps recorded before it, charged to the run owner', () =>
    inRolledBack(async tx => {
      const owner = await user(tx)
      const accountId = await identity(tx, owner)
      const [run] = await tx
        .insert(schema.runsTable)
        .values({ accountId, status: 'completed' })
        .returning({ id: schema.runsTable.id })
      const runId = run!.id
      await tx.insert(schema.runStepsTable).values([
        {
          runId,
          stage: 'drafting',
          status: 'completed',
          tokens: 21248,
          costUsd: '0.0942',
          responseJson: {
            model: 'anthropic/claude-sonnet-5-5',
            usage: usage(0.094248, {
              calls: 2,
              inputTokens: 14779,
              outputTokens: 6469,
              totalTokens: 21248
            })
          }
        },
        {
          runId,
          stage: 'media',
          status: 'completed',
          costUsd: '0.0600',
          responseJson: { model: 'bfl/flux-2-pro', usage: usage(0.06) }
        },
        // Nothing billed: nothing to copy.
        { runId, stage: 'gathering_context', status: 'completed' }
      ])

      // The copy runs only into an empty ledger; this deletion is rolled back too.
      await tx.execute(sql`delete from ai_usage`)
      await tx.execute(sql.raw(backfill))
      const copied = () =>
        tx
          .select()
          .from(schema.aiUsageTable)
          .where(eq(schema.aiUsageTable.runId, runId))
          .orderBy(asc(schema.aiUsageTable.stage))
      const rows = await copied()
      assert.deepStrictEqual(
        rows.map(r => [
          r.stage,
          r.model,
          r.calls,
          r.inputTokens,
          r.outputTokens,
          r.totalTokens,
          Number(r.costUsd),
          r.costEstimated,
          r.source,
          r.userId,
          r.accountId
        ]),
        [
          [
            'drafting',
            'anthropic/claude-sonnet-5-5',
            2,
            14779,
            6469,
            21248,
            0.094248,
            false,
            'runs',
            owner,
            accountId
          ],
          [
            'media',
            'bfl/flux-2-pro',
            1,
            0,
            0,
            0,
            0.06,
            false,
            'runs',
            owner,
            accountId
          ]
        ]
      )

      // Applied again, the migration copies nothing twice.
      for (const statement of migration) await tx.execute(sql.raw(statement))
      assert.strictEqual((await copied()).length, 2)
    }))

  it('limits a user by their spend on every identity, and before one, over the last 30 days', () =>
    inRolledBack(async tx => {
      const owner = await user(tx)
      const first = await identity(tx, owner)
      const second = await identity(tx, owner)
      const someoneElse = await user(tx)
      const theirs = await identity(tx, someoneElse)

      await recordUsageIn(
        tx,
        charge({ userId: owner, accountId: first }),
        call(usage(1.5))
      )
      await recordUsageIn(
        tx,
        charge({ source: 'newsletters', userId: owner, accountId: second }),
        call(usage(2.25), 'extraction')
      )
      // AI setup for an identity not made yet.
      await recordUsageIn(
        tx,
        charge({ source: 'identity', userId: owner }),
        call(usage(0.25), 'identity_setup')
      )
      await recordUsageIn(
        tx,
        charge({ userId: someoneElse, accountId: theirs }),
        call(usage(9))
      )
      // Spent before the window: no longer counted.
      await tx.insert(schema.aiUsageTable).values({
        userId: owner,
        accountId: first,
        source: 'runs',
        stage: 'drafting',
        model: 'anthropic/claude-sonnet-5-5',
        costUsd: '50',
        createdAt: sql`now() - interval '31 days'`
      })

      assert.strictEqual(await accountOwnerIn(tx, second), owner)
      assert.strictEqual(
        await spentInWindowIn(tx, { userId: owner, accountId: second }),
        4
      )
      assert.strictEqual(
        await spentInWindowIn(tx, { userId: someoneElse, accountId: theirs }),
        9
      )
      // Shared work, charged to no one, is limited for no one.
      assert.strictEqual(
        await spentInWindowIn(tx, { userId: null, accountId: null }),
        null
      )
    }))

  it('limits an identity no user owns by its own spend', () =>
    inRolledBack(async tx => {
      const legacy = await identity(tx, null)
      const owner = await user(tx)
      await recordUsageIn(
        tx,
        charge({ source: 'newsletters', accountId: legacy }),
        call(usage(2), 'extraction')
      )
      // Charged to its user once the identity has one, so not counted again here.
      await recordUsageIn(
        tx,
        charge({ userId: owner, accountId: legacy }),
        call(usage(7))
      )

      assert.strictEqual(await accountOwnerIn(tx, legacy), null)
      assert.strictEqual(
        await spentInWindowIn(tx, { userId: null, accountId: legacy }),
        2
      )
    }))

  it('keeps the spend of a call whose run or identity was deleted while it ran', () =>
    inRolledBack(async tx => {
      const owner = await user(tx)
      const gone = crypto.randomUUID()
      assert.strictEqual(
        await recordUsageIn(
          tx,
          charge({ userId: owner, accountId: gone, runId: gone }),
          call(usage(0.5))
        ),
        true
      )
      const rows = await tx
        .select()
        .from(schema.aiUsageTable)
        .where(eq(schema.aiUsageTable.userId, owner))
      assert.deepStrictEqual(
        rows.map(r => [r.accountId, r.runId, Number(r.costUsd)]),
        [[null, null, 0.5]]
      )
      assert.strictEqual(
        await spentInWindowIn(tx, { userId: owner, accountId: null }),
        0.5
      )
    }))

  it('records nothing for a call that billed nothing', () =>
    inRolledBack(async tx => {
      const owner = await user(tx)
      assert.strictEqual(
        await recordUsageIn(tx, charge({ userId: owner }), call(EMPTY_USAGE)),
        false
      )
      assert.strictEqual(
        await spentInWindowIn(tx, { userId: owner, accountId: null }),
        0
      )
    }))

  it("adds up an identity's spend overall and by what it was for", () =>
    inRolledBack(async tx => {
      const owner = await user(tx)
      const accountId = await identity(tx, owner)
      const other = await identity(tx, owner)
      const mine = charge({ userId: owner, accountId })
      await recordUsageIn(
        tx,
        { ...mine, source: 'posts' },
        call(
          usage(0.5, { totalTokens: 50, inputTokens: 40, cacheReadTokens: 30 })
        )
      )
      await recordUsageIn(
        tx,
        mine,
        call(usage(1, { totalTokens: 100, outputTokens: 60 }))
      )
      await recordUsageIn(tx, mine, call(usage(0.25, { totalTokens: 10 })))
      await recordUsageIn(
        tx,
        { ...mine, accountId: other },
        call(usage(5, { totalTokens: 999 }))
      )

      const { totals, bySource } = await accountUsageIn(tx, accountId)
      assert.deepStrictEqual(totals, {
        calls: 3,
        inputTokens: 40,
        outputTokens: 60,
        cacheReadTokens: 30,
        totalTokens: 160,
        costUsd: 1.75
      })
      // In AI_SPEND_SOURCES order; sources with no calls left out.
      assert.deepStrictEqual(bySource, [
        { source: 'runs', totalTokens: 110, costUsd: 1.25 },
        { source: 'posts', totalTokens: 50, costUsd: 0.5 }
      ])
    }))
})
