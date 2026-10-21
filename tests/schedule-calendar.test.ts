import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  dayLabel,
  isIsoDay,
  monthGrid,
  monthGridRange,
  monthLabel,
  monthParam,
  parseMonthParam,
  shiftMonth
} from '../src/lib/calendar'

describe('the Schedule month view', () => {
  it('shows whole Monday-to-Sunday weeks covering the month', () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const weeks = monthGrid({ year: 2026, month: 10 })
    assert.strictEqual(weeks[0]![0], '2026-09-28')
    assert.strictEqual(weeks.at(-1)![6], '2026-11-01')
    assert.ok(weeks.every(week => week.length === 7))
    const days = weeks.flat()
    assert.ok(days.includes('2026-10-01') && days.includes('2026-10-31'))
    assert.strictEqual(new Set(days).size, days.length)
  })

  it('needs no padding when the month starts on a Monday and ends on a Sunday', () => {
    // February 2027 runs from Monday the 1st to Sunday the 28th.
    const weeks = monthGrid({ year: 2027, month: 2 })
    assert.strictEqual(weeks.length, 4)
    assert.deepStrictEqual(monthGridRange({ year: 2027, month: 2 }), {
      from: '2027-02-01',
      to: '2027-02-28'
    })
  })

  it('reads ?month= and falls back on anything malformed', () => {
    const fallback = { year: 2026, month: 10 }
    assert.deepStrictEqual(parseMonthParam('2027-01', fallback), { year: 2027, month: 1 })
    for (const bad of ['2027-13', '27-01', '2027-1', 'x', undefined, ['2027-01']]) {
      assert.deepStrictEqual(parseMonthParam(bad, fallback), fallback, String(bad))
    }
  })

  it('moves across years', () => {
    assert.deepStrictEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 })
    assert.deepStrictEqual(shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 })
    assert.strictEqual(monthParam({ year: 2026, month: 3 }), '2026-03')
  })

  it('accepts only real days as a planned date', () => {
    assert.ok(isIsoDay('2026-02-28'))
    assert.ok(isIsoDay('2028-02-29'))
    for (const bad of ['2026-02-29', '2026-13-01', '2026-1-1', '2026-10-21T00:00', '', null, 20261021]) {
      assert.strictEqual(isIsoDay(bad), false, String(bad))
    }
  })

  it('spells dates the same way on the server and in the browser', () => {
    assert.strictEqual(monthLabel({ year: 2026, month: 10 }), 'October 2026')
    assert.strictEqual(dayLabel('2026-10-22'), 'Thursday, 22 October')
    assert.strictEqual(dayLabel('2027-01-03'), 'Sunday, 3 January')
  })
})
