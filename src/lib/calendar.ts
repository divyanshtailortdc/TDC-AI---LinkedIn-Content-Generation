/**
 * Calendar arithmetic for the Schedule page, on plain YYYY-MM-DD strings. A
 * planned date is a day, not an instant, so everything here works in UTC and
 * never shifts a day across a time zone.
 */

export type Month = { year: number; month: number }

const DAY_MS = 86_400_000

const pad = (n: number) => String(n).padStart(2, '0')

/** A YYYY-MM-DD string for a UTC date. */
export function isoDay(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** True for a real calendar day written as YYYY-MM-DD. */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && isoDay(date) === value
}

/** ?month=2026-10 as a month; anything else is `fallback`. */
export function parseMonthParam(value: unknown, fallback: Month): Month {
  const match =
    typeof value === 'string' ? /^(\d{4})-(\d{2})$/.exec(value) : null
  if (!match) return fallback
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return fallback
  return { year, month }
}

/** "2026-10" */
export function monthParam({ year, month }: Month): string {
  return `${year}-${pad(month)}`
}

/** The month `delta` months away. */
export function shiftMonth({ year, month }: Month, delta: number): Month {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/**
 * The days a month view shows, as weeks of seven YYYY-MM-DD strings from
 * Monday to Sunday: the whole month, padded with the days around it.
 */
export function monthGrid({ year, month }: Month): string[][] {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const last = new Date(Date.UTC(year, month, 0))
  // getUTCDay: Sunday is 0. Weeks here start on Monday.
  const start = first.getTime() - ((first.getUTCDay() + 6) % 7) * DAY_MS
  const end = last.getTime() + ((7 - last.getUTCDay()) % 7) * DAY_MS
  const weeks: string[][] = []
  for (let t = start; t <= end; t += 7 * DAY_MS) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => isoDay(new Date(t + i * DAY_MS)))
    )
  }
  return weeks
}

/** The first and last day a month view shows. */
export function monthGridRange(month: Month): { from: string; to: string } {
  const weeks = monthGrid(month)
  return { from: weeks[0]![0]!, to: weeks[weeks.length - 1]![6]! }
}

/** The day `date` falls on where the viewer is, as YYYY-MM-DD. */
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]

/**
 * "October 2026". Spelled out here rather than by toLocaleDateString: the
 * server and the browser format the same date differently ("Thursday 22
 * October" against "Thursday, 22 October"), which breaks hydration.
 */
export function monthLabel({ year, month }: Month): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

/** "Thursday, 22 October" for a YYYY-MM-DD day. */
export function dayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  return `${WEEKDAY_NAMES[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`
}
