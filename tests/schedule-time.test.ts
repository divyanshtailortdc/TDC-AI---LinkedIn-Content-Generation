import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  dueSlot,
  isValidTimeZone,
  nextSlot,
  parseTimeOfDay,
  SCHEDULE_GRACE_MS,
  type DueCheck
} from '../src/lib/schedule-time'

// Mon, Wed, Fri at 09:00 Asia/Kolkata (UTC+5:30), saved well before.
const base: DueCheck = {
  daysOfWeek: [1, 3, 5],
  timeOfDay: '09:00',
  timezone: 'Asia/Kolkata',
  lastRunAt: null,
  updatedAt: new Date('2026-10-01T00:00:00Z')
}
// Friday 2026-10-23, 09:00 in Kolkata.
const slot = new Date('2026-10-23T03:30:00Z')
const at = (ms: number) => new Date(slot.getTime() + ms)

describe('when a scheduled idea run is due', () => {
  it("reads the days and time in the schedule's own zone", () => {
    assert.deepStrictEqual(dueSlot(base, at(60_000)), { slot, weekday: 5 })
    // 09:00 UTC is 14:30 in Kolkata: not the slot, and the grace is over.
    assert.strictEqual(dueSlot(base, new Date('2026-10-23T09:00:00Z')), null)
    // Thursday in Kolkata is not a chosen day, even if it is Friday in UTC.
    assert.strictEqual(
      dueSlot({ ...base, daysOfWeek: [5] }, new Date('2026-10-22T03:40:00Z')),
      null
    )
  })

  it('is not due before the slot or after the grace period', () => {
    assert.strictEqual(dueSlot(base, at(-60_000)), null)
    assert.ok(dueSlot(base, at(SCHEDULE_GRACE_MS - 60_000)))
    assert.strictEqual(dueSlot(base, at(SCHEDULE_GRACE_MS)), null)
  })

  it('runs a slot once, but retries one whose claim was given back', () => {
    const ran = { ...base, lastRunAt: at(2 * 60_000) }
    assert.strictEqual(dueSlot(ran, at(5 * 60_000)), null)
    // Last week's run does not block this week's.
    const lastWeek = { ...base, lastRunAt: new Date('2026-10-21T03:31:00Z') }
    assert.deepStrictEqual(dueSlot(lastWeek, at(5 * 60_000))?.slot, slot)
  })

  it('does not run a slot that passed before the schedule was saved', () => {
    const justSaved = { ...base, updatedAt: at(30 * 60_000) }
    assert.strictEqual(dueSlot(justSaved, at(35 * 60_000)), null)
    const savedEarlier = { ...base, updatedAt: at(-30 * 60_000) }
    assert.deepStrictEqual(dueSlot(savedEarlier, at(35 * 60_000))?.slot, slot)
  })

  it("follows daylight saving in the schedule's zone", () => {
    const ny = {
      ...base,
      timezone: 'America/New_York',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
    }
    // 09:00 in New York is 13:00 UTC in summer time, 14:00 UTC after it ends.
    assert.ok(dueSlot(ny, new Date('2026-10-30T13:01:00Z')))
    assert.strictEqual(dueSlot(ny, new Date('2026-11-02T13:01:00Z')), null)
    assert.ok(dueSlot(ny, new Date('2026-11-02T14:01:00Z')))
  })

  it('ignores a bad time of day instead of running at a wrong one', () => {
    assert.strictEqual(
      dueSlot({ ...base, timeOfDay: 'soon' }, at(60_000)),
      null
    )
    assert.strictEqual(parseTimeOfDay('24:00'), null)
    assert.strictEqual(parseTimeOfDay('09:05'), 545)
  })

  it('knows real time zones', () => {
    assert.ok(isValidTimeZone('Asia/Kolkata'))
    assert.ok(!isValidTimeZone('Mars/Base'))
    assert.ok(!isValidTimeZone(''))
  })

  it('runs a calendar day once, even if the time is moved later that day', () => {
    // Ran at 09:02; the user then changes the time to 15:00.
    const ran = { ...base, lastRunAt: at(2 * 60_000), timeOfDay: '15:00' }
    const later = new Date('2026-10-23T09:35:00Z') // 15:05 in Kolkata
    assert.strictEqual(dueSlot(ran, later), null)
  })

  // Fridays and Saturdays at 23:58 in Kolkata. On Friday 23 Oct the next
  // tick, 00:00, is already Saturday there.
  const lateSlot = new Date('2026-10-23T18:28:00Z')
  const nearMidnight = { ...base, daysOfWeek: [5, 6], timeOfDay: '23:58' }

  it('keeps a late-evening slot due after midnight, for its own day', () => {
    // Every tick after 23:55 falls on the next day: the slot used to be lost.
    assert.deepStrictEqual(
      dueSlot(nearMidnight, new Date('2026-10-23T18:30:00Z')),
      {
        slot: lateSlot,
        weekday: 5
      }
    )
    // The grace period still ends two hours after the slot.
    assert.ok(
      dueSlot(
        nearMidnight,
        new Date(lateSlot.getTime() + SCHEDULE_GRACE_MS - 60_000)
      )
    )
    assert.strictEqual(
      dueSlot(nearMidnight, new Date(lateSlot.getTime() + SCHEDULE_GRACE_MS)),
      null
    )
    // A 23:00 slot that failed until midnight is retried after it.
    assert.deepStrictEqual(
      dueSlot({ ...base, timeOfDay: '23:00' }, new Date('2026-10-23T18:40:00Z'))
        ?.weekday,
      5
    )
  })

  it("does not run yesterday's slot when yesterday is not a chosen day", () => {
    // Saturday 00:00 in Kolkata, Saturdays only: Friday's 23:58 is not one.
    assert.strictEqual(
      dueSlot(
        { ...nearMidnight, daysOfWeek: [6] },
        new Date('2026-10-23T18:30:00Z')
      ),
      null
    )
  })

  it("does not run yesterday's slot twice, nor let it block today's", () => {
    // Claimed at 00:00 Saturday for Friday's slot: lastRunAt is the slot.
    const ran = { ...nearMidnight, lastRunAt: lateSlot }
    assert.strictEqual(dueSlot(ran, new Date('2026-10-23T18:35:00Z')), null)
    // Saturday's own 23:58 still runs, at its first tick after midnight.
    assert.deepStrictEqual(dueSlot(ran, new Date('2026-10-24T18:30:00Z')), {
      slot: new Date('2026-10-24T18:28:00Z'),
      weekday: 6
    })
    // And the schedule page counts Saturday as still to come.
    assert.deepStrictEqual(
      nextSlot(ran, new Date('2026-10-23T18:35:00Z'))?.slot,
      new Date('2026-10-24T18:28:00Z')
    )
  })

  it('is due on a tick for every minute of the day, every day', () => {
    // The scheduler ticks every five minutes; no time of day may fall between.
    const daily = { ...base, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }
    const start = Date.parse('2026-10-22T18:30:00Z') // Friday 00:00 in Kolkata
    for (const time of ['00:00', '09:03', '23:55', '23:56', '23:59']) {
      let due = 0
      for (let t = start; t < start + 86_400_000; t += 5 * 60_000) {
        if (dueSlot({ ...daily, timeOfDay: time }, new Date(t))) due++
      }
      assert.ok(due > 0, `${time} was never due`)
    }
  })

  it("does not run yesterday's slot when the schedule was saved after it", () => {
    // Saved at 23:59 Friday, after the 23:58 slot.
    const saved = {
      ...nearMidnight,
      updatedAt: new Date('2026-10-23T18:29:00Z')
    }
    assert.strictEqual(dueSlot(saved, new Date('2026-10-23T18:30:00Z')), null)
  })
})

describe('the next run date', () => {
  const week = { ...base, daysOfWeek: [1, 3, 5] }

  it('is today when the time has not come, else the next chosen day', () => {
    assert.deepStrictEqual(nextSlot(week, at(-60_000)), {
      slot,
      weekday: 5,
      zone: 'Asia/Kolkata'
    })
    // Friday after 09:00: next is Monday 09:00 Kolkata = 03:30 UTC.
    assert.deepStrictEqual(
      nextSlot(week, at(3_600_000))?.slot,
      new Date('2026-10-26T03:30:00Z')
    )
  })

  it('skips a day that already ran, and a day that is not chosen', () => {
    const ran = { ...week, lastRunAt: at(60_000), timeOfDay: '15:00' }
    // Same Friday, 15:00 still ahead, but today already ran.
    assert.strictEqual(nextSlot(ran, at(30 * 60_000))?.weekday, 1)
    assert.strictEqual(nextSlot({ ...base, daysOfWeek: [] }, slot), null)
  })

  it('crosses a month and a year', () => {
    const fridays = { ...base, daysOfWeek: [5] }
    // Friday 30 Oct, after the slot: next Friday is 6 Nov.
    assert.deepStrictEqual(
      nextSlot(fridays, new Date('2026-10-30T10:00:00Z'))?.slot,
      new Date('2026-11-06T03:30:00Z')
    )
    // Thursday 31 Dec evening: Monday is 4 Jan 2027.
    assert.deepStrictEqual(
      nextSlot({ ...base, daysOfWeek: [1] }, new Date('2026-12-31T18:00:00Z'))
        ?.slot,
      new Date('2027-01-04T03:30:00Z')
    )
  })

  it("counts days in the schedule's zone, not the server's", () => {
    // 20:00 UTC Thursday is already 01:30 Friday in Kolkata: today's slot.
    const next = nextSlot(
      { ...base, daysOfWeek: [5] },
      new Date('2026-10-22T20:00:00Z')
    )
    assert.deepStrictEqual(next?.slot, slot)
    // And in New York the same instant is still Thursday afternoon.
    const ny = nextSlot(
      { ...base, daysOfWeek: [5], timezone: 'America/New_York' },
      new Date('2026-10-22T20:00:00Z')
    )
    assert.deepStrictEqual(ny?.slot, new Date('2026-10-23T13:00:00Z'))
  })
})
