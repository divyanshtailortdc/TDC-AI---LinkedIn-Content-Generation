import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import {
  insertRunUnlessActive,
  RunInProgressError,
  runLockKey
} from '../src/jobs/run-guard'
import {
  claimScheduleSlot,
  findRunnableSchedules
} from '../src/jobs/schedule-claim'

// Runs against the local development database; every row it makes is removed.
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]

describe('runs and schedules are guarded', { skip: !url }, () => {
  const client = postgres(url!, { max: 8, prepare: false })
  const database = drizzle(client, { schema })
  const tag = `qa-guard-${Date.now().toString(36)}`
  const ids: { a: string; b: string; c: string; inactive: string } = {
    a: '',
    b: '',
    c: '',
    inactive: ''
  }
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  const makeAccount = async (suffix: string, isActive = true) => {
    const [row] = await database
      .insert(schema.accountsTable)
      .values({
        name: 'QA Guard',
        accountType: 'personal',
        handle: `${tag}-${suffix}`,
        headline: 'QA',
        bio: 'QA',
        industry: 'Finance',
        isActive
      })
      .returning()
    return row!.id
  }
  const run = (accountId: string) => ({
    accountId,
    workflow: 'standard',
    trigger: 'manual',
    status: 'queued'
  })

  before(async () => {
    ids.a = await makeAccount('a')
    ids.b = await makeAccount('b')
    ids.c = await makeAccount('c')
    ids.inactive = await makeAccount('off', false)
  })
  after(async () => {
    await client`delete from accounts where handle like ${tag + '%'}`
    await client.end()
  })

  it('two runs started together for one identity: only one is created', async () => {
    const results = await Promise.allSettled([
      insertRunUnlessActive(database, run(ids.a)),
      insertRunUnlessActive(database, run(ids.a)),
      insertRunUnlessActive(database, run(ids.a))
    ])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    const rejected = results.filter(
      r => r.status === 'rejected'
    ) as PromiseRejectedResult[]
    assert.equal(rejected.length, 2)
    for (const r of rejected) assert.ok(r.reason instanceof RunInProgressError)
    const rows = await client`select id from runs where account_id = ${ids.a}`
    assert.equal(rows.length, 1)
  })

  it('a second request waits for the first one, then sees its run', async () => {
    // The first request holds the identity's lock, as it would while checking
    // and inserting, and creates a queued run before letting go.
    const first = database.transaction(async tx => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${runLockKey(ids.c)}))`
      )
      await sleep(500)
      await tx.insert(schema.runsTable).values(run(ids.c))
    })
    await sleep(150)

    const second = insertRunUnlessActive(database, run(ids.c))
    const early = await Promise.race([
      second.then(
        () => 'finished',
        () => 'finished'
      ),
      sleep(250).then(() => 'waiting')
    ])
    assert.equal(early, 'waiting', 'the second request must wait for the lock')

    await first
    await assert.rejects(second, RunInProgressError)
    const rows = await client`select id from runs where account_id = ${ids.c}`
    assert.equal(rows.length, 1)
  })

  it('another identity is not blocked', async () => {
    await insertRunUnlessActive(database, run(ids.b))
    const rows = await client`select id from runs where account_id = ${ids.b}`
    assert.equal(rows.length, 1)
  })

  it('a run waiting for idea approval does not block the next run', async () => {
    await client`update runs set status = 'awaiting_idea_approval' where account_id = ${ids.a}`
    await insertRunUnlessActive(database, run(ids.a))
    const rows = await client`select id from runs where account_id = ${ids.a}`
    assert.equal(rows.length, 2)
  })

  it('a run that is running blocks, and a finished one does not', async () => {
    await client`update runs set status = 'running' where account_id = ${ids.a} and status = 'queued'`
    await assert.rejects(
      insertRunUnlessActive(database, run(ids.a)),
      RunInProgressError
    )
    await client`update runs set status = 'completed' where account_id = ${ids.a}`
    await insertRunUnlessActive(database, run(ids.a))
  })

  it('a schedule slot is claimed by exactly one of two ticks', async () => {
    const [schedule] = await database
      .insert(schema.schedulesTable)
      .values({ accountId: ids.b, enabled: true })
      .returning()
    const now = new Date()
    const results = await Promise.all([
      claimScheduleSlot(database, schedule!, now),
      claimScheduleSlot(database, schedule!, now)
    ])
    assert.deepEqual(results.sort(), [false, true])

    // And the next day's slot is claimable again from the new lastRunAt.
    const [after] = await database
      .select()
      .from(schema.schedulesTable)
      .where(eq(schema.schedulesTable.id, schedule!.id))
    assert.equal(
      await claimScheduleSlot(
        database,
        after!,
        new Date(Date.now() + 86_400_000)
      ),
      true
    )
  })

  it('the old claim (update by id only) let both ticks through', async () => {
    const [schedule] = await database
      .insert(schema.schedulesTable)
      .values({ accountId: ids.a, enabled: true })
      .returning()
    const claimOldWay = () =>
      database
        .update(schema.schedulesTable)
        .set({ lastRunAt: new Date() })
        .where(eq(schema.schedulesTable.id, schedule!.id))
        .returning()
    const [first, second] = await Promise.all([claimOldWay(), claimOldWay()])
    assert.equal(first.length + second.length, 2)
  })

  it('schedules of a deactivated identity are not run', async () => {
    await database
      .insert(schema.schedulesTable)
      .values({ accountId: ids.inactive, enabled: true })
    const runnable = (await findRunnableSchedules(database)).map(
      s => s.accountId
    )
    assert.ok(runnable.includes(ids.a))
    assert.ok(!runnable.includes(ids.inactive))
  })

  it('a disabled schedule is not run', async () => {
    await client`update schedules set enabled = false where account_id = ${ids.a}`
    const runnable = (await findRunnableSchedules(database)).map(
      s => s.accountId
    )
    assert.ok(!runnable.includes(ids.a))
  })
})
