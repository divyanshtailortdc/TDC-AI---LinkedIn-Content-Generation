import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  checkSchedulePayload,
  type SchedulePayload
} from '../src/lib/schedule-payload'

const ok: SchedulePayload = {
  daysOfWeek: [1, 5],
  timeOfDay: '09:00',
  enabled: true,
  dayGoals: { '1': ['a'], '5': ['b', 'c'] },
  timezone: 'Asia/Kolkata'
}

describe('what a schedule may be saved with', () => {
  it('keeps each day its own goals and drops days that are not chosen', () => {
    const saved = checkSchedulePayload({
      ...ok,
      dayGoals: { ...ok.dayGoals, '3': ['stale'] }
    })
    assert.deepStrictEqual(saved.dayGoals, { '1': ['a'], '5': ['b', 'c'] })
  })

  it('refuses no day, a bad day, a bad time or an unknown zone', () => {
    assert.throws(
      () => checkSchedulePayload({ ...ok, daysOfWeek: [] }),
      /at least one day/
    )
    assert.throws(
      () => checkSchedulePayload({ ...ok, daysOfWeek: [7] }),
      /at least one day/
    )
    assert.throws(
      () => checkSchedulePayload({ ...ok, timeOfDay: '25:00' }),
      /valid time/
    )
    assert.throws(
      () => checkSchedulePayload({ ...ok, timezone: 'Mars/Base' }),
      /time zone/
    )
  })

  it('refuses a day with no goal while the schedule is on, naming the day', () => {
    assert.throws(
      () => checkSchedulePayload({ ...ok, dayGoals: { '1': ['a'], '5': [] } }),
      /at least one goal for Friday/
    )
    // A missing entry is no goal either.
    assert.throws(
      () => checkSchedulePayload({ ...ok, dayGoals: { '1': ['a'] } }),
      /at least one goal for Friday/
    )
  })

  it('saves a draft with empty days while the schedule is off', () => {
    const saved = checkSchedulePayload({ ...ok, enabled: false, dayGoals: {} })
    assert.deepStrictEqual(saved.dayGoals, { '1': [], '5': [] })
  })

  it('leaves goals open when none are sent: every active goal', () => {
    const { dayGoals: _omit, ...withoutGoals } = ok
    assert.strictEqual(checkSchedulePayload(withoutGoals).dayGoals, null)
  })
})
