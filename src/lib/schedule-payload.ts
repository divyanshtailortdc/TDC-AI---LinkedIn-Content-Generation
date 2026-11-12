import { MAX_GOALS_PER_RUN } from '@/jobs/run-goals'
import { isPlatformId, type PlatformId } from '@/lib/platforms'
import {
  isValidTimeZone,
  parseTimeOfDay,
  WEEKDAY_NAMES
} from '@/lib/schedule-time'

export type SchedulePayload = {
  daysOfWeek: number[]
  timeOfDay: string
  enabled: boolean
  /**
   * The goals each chosen day's run serves, by weekday (0 is Sunday). Left
   * out, every day serves every active goal.
   */
  dayGoals?: Record<string, string[]>
  /**
   * The one platform each chosen day's run plans ideas for, by weekday. A
   * day left out plans for every platform the identity posts on.
   */
  dayPlatforms?: Record<string, string>
  /** The viewer's IANA zone; kept as saved before when left out. */
  timezone?: string
}

/**
 * The days and per-day goals a schedule may be saved with; throws an Error
 * whose message is safe to show. A schedule that is on needs a goal for every
 * chosen day, one that is off may be saved as a draft. Goals are only checked
 * for shape here: that they are the identity's own is the caller's job.
 */
export function checkSchedulePayload(payload: SchedulePayload): {
  daysOfWeek: number[]
  dayGoals: Record<string, string[]> | null
  dayPlatforms: Record<string, PlatformId> | null
} {
  const daysOfWeek = Array.from(new Set(payload.daysOfWeek))
  if (
    daysOfWeek.length === 0 ||
    !daysOfWeek.every(d => Number.isInteger(d) && d >= 0 && d <= 6)
  ) {
    throw new Error('Pick at least one day.')
  }
  if (parseTimeOfDay(payload.timeOfDay) === null) {
    throw new Error('Pick a valid time.')
  }
  if (payload.timezone !== undefined && !isValidTimeZone(payload.timezone)) {
    throw new Error('That time zone is not valid.')
  }
  const dayPlatforms = checkDayPlatforms(daysOfWeek, payload.dayPlatforms)
  if (!payload.dayGoals) return { daysOfWeek, dayGoals: null, dayPlatforms }

  // An entry for a day that is not chosen is dropped rather than kept.
  const dayGoals: Record<string, string[]> = {}
  for (const day of daysOfWeek) {
    const ids = Array.from(new Set(payload.dayGoals[String(day)] ?? []))
    if (ids.length > MAX_GOALS_PER_RUN) {
      throw new Error(
        `Pick at most ${MAX_GOALS_PER_RUN} goals for ${WEEKDAY_NAMES[day]}.`
      )
    }
    if (ids.length === 0 && payload.enabled) {
      throw new Error(`Pick at least one goal for ${WEEKDAY_NAMES[day]}.`)
    }
    dayGoals[String(day)] = ids
  }
  return { daysOfWeek, dayGoals, dayPlatforms }
}

/**
 * Each chosen day's platform, when it has one; days not chosen are dropped.
 * Null when no day is limited to a platform.
 */
function checkDayPlatforms(
  daysOfWeek: number[],
  value: Record<string, string> | undefined
): Record<string, PlatformId> | null {
  if (!value) return null
  const out: Record<string, PlatformId> = {}
  for (const day of daysOfWeek) {
    const platform = value[String(day)]
    if (platform === undefined || platform === null) continue
    if (!isPlatformId(platform)) {
      throw new Error(`Pick a platform you post on for ${WEEKDAY_NAMES[day]}.`)
    }
    out[String(day)] = platform
  }
  return Object.keys(out).length > 0 ? out : null
}

/** The one platform a weekday's scheduled run plans for, or null for every platform. */
export function scheduledChannel(
  schedule: { dayPlatforms?: Record<string, string> | null },
  weekday: number
): PlatformId | null {
  const platform = schedule.dayPlatforms?.[String(weekday)]
  return isPlatformId(platform) ? platform : null
}
