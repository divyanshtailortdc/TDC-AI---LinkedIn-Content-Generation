/**
 * When an automatic idea run is due. A schedule is "these weekdays at this
 * wall-clock time in this time zone"; everything here turns that into instants
 * and decides whether a slot is due, with no database or clock of its own.
 */

/** How long after its slot a run may still start (a restart, a retry). */
export const SCHEDULE_GRACE_MS = 2 * 60 * 60 * 1000

/** Weekday names, indexed as a schedule's days (0 is Sunday). */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]

const TIME_OF_DAY = /^([01]?\d|2[0-3]):([0-5]\d)$/

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
}

/** True for an IANA zone name this runtime knows, like "Asia/Kolkata". */
export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || zone.length === 0 || zone.length > 64) {
    return false
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The zone this process runs in: where a schedule with no zone of its own runs. */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** "09:00" as minutes after midnight; null when it is not a time of day. */
export function parseTimeOfDay(value: string): number | null {
  const match = TIME_OF_DAY.exec(value.trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  /** 0 is Sunday, as in a schedule's days. */
  weekday: number
}

/** The wall-clock date and time `date` shows in `zone`. */
function zonedParts(date: Date, zone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short'
  }).formatToParts(date)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: WEEKDAYS[get('weekday')] ?? 0
  }
}

/** How far `zone` is ahead of UTC at this instant, in ms. */
function zoneOffsetMs(instant: Date, zone: string): number {
  const p = zonedParts(instant, zone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  // Whole minutes only: the formatter shows no seconds.
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000
}

/** The instant that is `minutes` after midnight on `day` of `zone`'s calendar. */
function instantOf(
  day: Pick<ZonedParts, 'year' | 'month' | 'day'>,
  minutes: number,
  zone: string
): Date {
  const wall = Date.UTC(day.year, day.month - 1, day.day, 0, minutes)
  // The offset at the first guess can differ from the offset at the answer
  // when a daylight-saving change falls between them; a second pass settles it.
  const first = wall - zoneOffsetMs(new Date(wall), zone)
  return new Date(wall - zoneOffsetMs(new Date(first), zone))
}

export type DueCheck = {
  daysOfWeek: number[] | null
  timeOfDay: string
  /** null: the server's zone, for schedules saved before zones were stored. */
  timezone: string | null
  lastRunAt: Date | null
  /** When the user last saved the schedule. */
  updatedAt: Date
}

/** The zone a schedule's days and time are read in. */
export function zoneOf(schedule: Pick<DueCheck, 'timezone'>): string {
  return schedule.timezone && isValidTimeZone(schedule.timezone)
    ? schedule.timezone
    : serverTimeZone()
}

/** `date`'s calendar day in `zone`, as YYYY-MM-DD. */
function localDayKey(date: Date, zone: string): string {
  const p = zonedParts(date, zone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** A calendar day `offset` days after `day`, whatever month or year that is. */
function addDays(
  day: Pick<ZonedParts, 'year' | 'month' | 'day'>,
  offset: number
): Pick<ZonedParts, 'year' | 'month' | 'day'> & { weekday: number } {
  const d = new Date(Date.UTC(day.year, day.month - 1, day.day + offset))
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay()
  }
}

/** A run is already on record for this calendar day of the schedule's zone. */
function ranOnDay(
  lastRunAt: Date | null,
  day: Pick<ZonedParts, 'year' | 'month' | 'day'>,
  zone: string
): boolean {
  if (!lastRunAt) return false
  const key = `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`
  return localDayKey(lastRunAt, zone) === key
}

/**
 * The slot that should start a run now, with the weekday it belongs to (whose
 * goals the run serves), or null.
 *
 * A slot is due from its time until SCHEDULE_GRACE_MS later, so a restart or
 * a failed attempt still gets its run on the next tick instead of waiting a
 * week. That window can run past midnight: a 23:58 slot is first ticked at
 * 00:00, so yesterday's slot is looked at too. It is not due when
 *  - its day is not one of the chosen days, in the schedule's own zone,
 *  - a run is already on record for its calendar day (so moving the time
 *    later on the day a run happened, or changing zone, cannot run the day
 *    twice), or
 *  - the schedule was saved after the slot passed: saving at 09:30 an 09:00
 *    schedule must not start a run nobody asked for.
 *
 * The claim records the slot itself as `lastRunAt` (see scheduler), so a run
 * that starts after midnight still counts for the day it was scheduled on.
 */
export function dueSlot(
  schedule: DueCheck,
  now: Date
): { slot: Date; weekday: number } | null {
  const zone = zoneOf(schedule)
  const minutes = parseTimeOfDay(schedule.timeOfDay || '09:00')
  if (minutes === null) return null

  const days = schedule.daysOfWeek ?? [1, 3, 5]
  const today = zonedParts(now, zone)
  // The grace period is shorter than a day, so at most one of the two slots
  // is inside it.
  for (const offset of [0, -1]) {
    const day = addDays(today, offset)
    if (!days.includes(day.weekday)) continue
    const slot = instantOf(day, minutes, zone)
    const late = now.getTime() - slot.getTime()
    if (late < 0 || late >= SCHEDULE_GRACE_MS) continue
    if (schedule.updatedAt.getTime() > slot.getTime()) return null
    if (schedule.lastRunAt && schedule.lastRunAt.getTime() >= slot.getTime()) {
      return null
    }
    if (ranOnDay(schedule.lastRunAt, day, zone)) return null
    return { slot, weekday: day.weekday }
  }
  return null
}

/**
 * The next slot after `now`: the first chosen day, today included, whose time
 * has not come yet and which has no run on record. Counting is by calendar day
 * in the schedule's zone, so a week or month ending, or a zone that is
 * already on the next day, moves on correctly. Null when no day is chosen.
 */
export function nextSlot(
  schedule: Omit<DueCheck, 'updatedAt'>,
  now: Date
): { slot: Date; weekday: number; zone: string } | null {
  const zone = zoneOf(schedule)
  const minutes = parseTimeOfDay(schedule.timeOfDay || '09:00')
  const days = schedule.daysOfWeek ?? [1, 3, 5]
  if (minutes === null || days.length === 0) return null

  const today = zonedParts(now, zone)
  // Eight days reach the same weekday next week, after today's has passed.
  for (let offset = 0; offset <= 7; offset++) {
    const day = addDays(today, offset)
    if (!days.includes(day.weekday)) continue
    const slot = instantOf(day, minutes, zone)
    if (slot.getTime() <= now.getTime()) continue
    if (ranOnDay(schedule.lastRunAt, day, zone)) continue
    return { slot, weekday: day.weekday, zone }
  }
  return null
}
