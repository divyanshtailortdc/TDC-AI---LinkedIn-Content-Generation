import assert from 'node:assert/strict'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/db/schema'

// Runs against the local development database; every row it makes is removed.
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]

// Run with: DATABASE_URL=… npx tsx --conditions=react-server --test tests/schedule-run.test.ts
describe('a scheduled run generates ideas for the chosen goals', { skip: !url }, () => {
  const client = postgres(url!, { max: 4, prepare: false })
  const database = drizzle(client, { schema })
  const tag = `qa-sched-${Date.now().toString(36)}`
  const ids = { a: '', b: '', c: '', d: '', one: '', two: '', unpicked: '', paused: '', only: '', fri: '', sat: '' }
  let scheduleId = ''
  let emptyScheduleId = ''
  let legacyScheduleId = ''
  let lateScheduleId = ''

  // Fridays and Saturdays at 09:00 UTC, saved long before the slots below.
  // The scheduler's tick at 09:05 starts the 09:00 slot.
  const friday = new Date('2027-03-05T09:05:00Z')
  const fridaySlot = new Date('2027-03-05T09:00:00Z')
  const saturday = new Date('2027-03-06T09:05:00Z')

  const makeAccount = async (suffix: string) => {
    const [row] = await database
      .insert(schema.accountsTable)
      .values({
        name: 'QA Schedule',
        accountType: 'personal',
        handle: `${tag}-${suffix}`,
        headline: 'QA',
        bio: 'QA',
        industry: 'Finance'
      })
      .returning()
    return row!.id
  }
  const makeGoal = async (accountId: string, title: string, isActive = true) => {
    const [row] = await database
      .insert(schema.goalsTable)
      .values({ accountId, title, keyMessage: `${title} message`, isActive })
      .returning()
    return row!.id
  }
  const schedule = async (id: string) =>
    (await database.query.schedulesTable.findFirst({
      where: eq(schema.schedulesTable.id, id)
    }))!
  const runsOf = (accountId: string) =>
    database.query.runsTable.findMany({
      where: eq(schema.runsTable.accountId, accountId)
    })

  before(async () => {
    const { runScheduleIfDue } = await import('../src/jobs/scheduler')
    run = runScheduleIfDue
    ids.a = await makeAccount('a')
    ids.b = await makeAccount('b')
    ids.c = await makeAccount('c')
    ids.only = await makeGoal(ids.c, 'Only goal')
    ids.one = await makeGoal(ids.a, 'First goal')
    await new Promise(r => setTimeout(r, 20))
    ids.two = await makeGoal(ids.a, 'Second goal')
    ids.unpicked = await makeGoal(ids.a, 'Unpicked goal')
    ids.paused = await makeGoal(ids.a, 'Paused goal', false)
    ids.d = await makeAccount('d')
    ids.fri = await makeGoal(ids.d, 'Friday goal')
    ids.sat = await makeGoal(ids.d, 'Saturday goal')
    const base = {
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      timeOfDay: '09:00',
      timezone: 'UTC',
      enabled: true,
      updatedAt: new Date('2027-01-01T00:00:00Z')
    }
    const [main] = await database
      .insert(schema.schedulesTable)
      // Friday and Saturday have their own goals. Friday also lists a paused
      // goal and a deleted one, which must simply be ignored.
      .values({
        accountId: ids.a,
        ...base,
        dayGoals: {
          '5': [ids.one, ids.two, ids.paused, crypto.randomUUID()],
          '6': [ids.unpicked]
        }
      })
      .returning()
    scheduleId = main!.id
    const [empty] = await database
      .insert(schema.schedulesTable)
      .values({ accountId: ids.b, ...base, dayGoals: { '5': [] } })
      .returning()
    emptyScheduleId = empty!.id
    // A schedule saved before days had their own goals serves every active one.
    const [legacy] = await database
      .insert(schema.schedulesTable)
      .values({ accountId: ids.c, ...base, dayGoals: null })
      .returning()
    legacyScheduleId = legacy!.id
    // Fridays and Saturdays at 23:58 UTC: every tick that can start one falls
    // on the next day.
    const [late] = await database
      .insert(schema.schedulesTable)
      .values({
        accountId: ids.d,
        ...base,
        daysOfWeek: [5, 6],
        timeOfDay: '23:58',
        dayGoals: { '5': [ids.fri], '6': [ids.sat] }
      })
      .returning()
    lateScheduleId = late!.id
  })

  after(async () => {
    await client`delete from accounts where handle like ${tag + '%'}`
    await client.end()
  })

  let run: typeof import('../src/jobs/scheduler').runScheduleIfDue

  it('queues one run for the goals of the day, active ones only, newest first', async () => {
    await run(await schedule(scheduleId), friday)
    const runs = await runsOf(ids.a)
    assert.equal(runs.length, 1)
    assert.equal(runs[0]!.trigger, 'schedule')
    assert.equal(runs[0]!.status, 'queued')
    assert.deepEqual(runs[0]!.goalIds, [ids.two, ids.one])
    // The slot is recorded, not the tick that started it.
    const after = await schedule(scheduleId)
    assert.deepEqual(after.lastRunAt, fridaySlot)
    assert.equal(after.lastError, null)
  })

  it('a later tick, or a second process with a stale row, adds no run', async () => {
    const stale = await schedule(scheduleId)
    stale.lastRunAt = null
    await run(stale, friday)
    await run(await schedule(scheduleId), new Date(friday.getTime() + 300_000))
    assert.equal((await runsOf(ids.a)).length, 1)
  })

  it('a run already in progress delays the slot instead of losing it', async () => {
    const before = await schedule(scheduleId)
    await run(before, saturday)
    assert.equal((await runsOf(ids.a)).length, 1)
    assert.deepEqual((await schedule(scheduleId)).lastRunAt, before.lastRunAt)

    await client`update runs set status = 'completed' where account_id = ${ids.a}`
    await run(await schedule(scheduleId), new Date(saturday.getTime() + 300_000))
    // Saturday writes for Saturday's goals, not Friday's.
    const runs = await runsOf(ids.a)
    assert.equal(runs.length, 2)
    const latest = runs.sort((x, y) => +y.createdAt - +x.createdAt)[0]!
    assert.deepEqual(latest.goalIds, [ids.unpicked])
  })

  it('a schedule with no per-day goals serves every active goal', async () => {
    await run(await schedule(legacyScheduleId), friday)
    assert.deepEqual((await runsOf(ids.c))[0]!.goalIds, [ids.only])
  })

  it('a schedule with no goal starts nothing and says why', async () => {
    await run(await schedule(emptyScheduleId), friday)
    assert.equal((await runsOf(ids.b)).length, 0)
    const after = await schedule(emptyScheduleId)
    assert.match(after.lastError ?? '', /on Friday.*at least one active goal/)
    assert.deepEqual(after.lastRunAt, fridaySlot)
  })

  it("a late-evening slot ticked after midnight runs once, for its own day's goals", async () => {
    // Saturday 00:00: Friday's 23:58 slot, with Friday's goal.
    await run(await schedule(lateScheduleId), new Date('2027-03-06T00:00:00Z'))
    let runs = await runsOf(ids.d)
    assert.equal(runs.length, 1)
    assert.deepEqual(runs[0]!.goalIds, [ids.fri])
    assert.deepEqual(
      (await schedule(lateScheduleId)).lastRunAt,
      new Date('2027-03-05T23:58:00Z')
    )

    // The next tick finds it already run.
    await client`update runs set status = 'completed' where account_id = ${ids.d}`
    await run(await schedule(lateScheduleId), new Date('2027-03-06T00:05:00Z'))
    assert.equal((await runsOf(ids.d)).length, 1)

    // Sunday 00:00: Saturday's own slot still runs, with Saturday's goal.
    await run(await schedule(lateScheduleId), new Date('2027-03-07T00:00:00Z'))
    runs = await runsOf(ids.d)
    assert.equal(runs.length, 2)
    const latest = runs.sort((x, y) => +y.createdAt - +x.createdAt)[0]!
    assert.deepEqual(latest.goalIds, [ids.sat])
  })
})
