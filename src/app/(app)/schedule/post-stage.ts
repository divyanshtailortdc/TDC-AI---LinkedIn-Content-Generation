import type { Tone } from '@/components/ui/tone'
import { isoDay, localDay } from '@/lib/calendar'
import { formatAbsoluteDate } from '@/lib/format-date'
import { isOnPlatform } from '@/lib/publishing/status'
import type { PlannedPost } from './schedule-data'

/**
 * Where a post stands on the Schedule page: its review, or once it is on its
 * way to its platform, how that is going.
 */
export type Stage =
  | 'draft'
  | 'to_review'
  | 'approved'
  | 'scheduled'
  | 'publishing'
  | 'failed'
  | 'posted'

/** In the order a post moves through them, for legends and filters. */
export const STAGE_ORDER: Stage[] = [
  'draft',
  'to_review',
  'approved',
  'scheduled',
  'publishing',
  'failed',
  'posted'
]

/** Tones as on Posts (see components/ui/tone.ts). */
export const STAGES: Record<Stage, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  to_review: { label: 'To review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  scheduled: { label: 'Scheduled', tone: 'brand' },
  publishing: { label: 'Publishing', tone: 'brand' },
  failed: { label: 'Publish failed', tone: 'danger' },
  posted: { label: 'Posted', tone: 'success' }
}

/**
 * The same reading as postStage on Posts (posts/post-status.tsx), so a post
 * says the same thing on both pages. Out on its platform or marked posted
 * comes first; a post deleted from its platform reads as approved again.
 */
export function stageOf(post: PlannedPost): Stage {
  const publication = post.publication
  if (post.postedAt || isOnPlatform(publication)) return 'posted'
  if (publication?.status === 'publishing') return 'publishing'
  if (publication?.status === 'scheduled') return 'scheduled'
  if (post.status === 'approved' && publication?.status === 'failed') {
    return 'failed'
  }
  if (post.status === 'approved') return 'approved'
  // Still being written; Posts shows it as a draft too.
  if (post.status === 'draft') return 'draft'
  return 'to_review'
}

/** The stage's word for this post: published from the app, or posted by hand. */
export function stageLabel(post: PlannedPost, stage = stageOf(post)): string {
  if (stage === 'posted' && post.publishedFromApp) return 'Published'
  return STAGES[stage].label
}

/**
 * When a queued publication is next tried: its time, or once an attempt
 * failed, the retry's. Null unless it is queued.
 */
export function queuedFor(post: PlannedPost): string | null {
  const publication = post.publication
  if (publication?.status !== 'scheduled') return null
  return publication.attempts > 0
    ? publication.nextAttemptAt
    : publication.scheduledAt
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "09:05" on the viewer's clock. Only once mounted (format-date.ts). */
export function clockTime(value: string | Date): string {
  const date = new Date(value)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * What a calendar entry shows of its queued publication: the time, or the
 * date when it goes out on another day than the one it is planned for.
 * Only once mounted.
 */
export function queuedLabel(post: PlannedPost): string | null {
  const at = queuedFor(post)
  if (!at) return null
  return post.plannedFor && localDay(new Date(at)) !== post.plannedFor
    ? formatAbsoluteDate(at)
    : clockTime(at)
}

/** The day `days` after (or before, when negative) a YYYY-MM-DD day. */
export function shiftDay(day: string, days: number): string {
  return isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000))
}
