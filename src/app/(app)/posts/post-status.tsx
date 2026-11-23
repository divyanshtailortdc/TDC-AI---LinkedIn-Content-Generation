import { StatusChip } from '@/components/ui/status-chip'
import type { Tone } from '@/components/ui/tone'
import { cn } from '@/lib/cn'
import { getPlatform } from '@/lib/platforms'
import { isOnPlatform } from '@/lib/publishing/status'
import { Check, Trash2 } from 'lucide-react'
import type { PostDetail } from './posts-client'

/** Where a post stands; postStage gives each its label and tone. */
export type PostStageKey =
  | 'published'
  | 'publishing'
  | 'scheduled'
  | 'failed'
  | 'approved'
  | 'rejected'
  | 'draft'
  | 'awaiting_review'

/**
 * Where a post stands, in a word: its review status, or once it is on its way
 * to its platform, how that is going. The list and the post page both show it,
 * in the app's status tones (src/components/ui/tone.ts), as Schedule does.
 */
export function postStage(post: PostDetail): {
  key: PostStageKey
  label: string
  tone: Tone
  /** On its way to its platform right now. */
  spinning?: boolean
} {
  const publication = post.publication?.status
  // Out on its platform (or marked posted). One deleted from its platform is
  // not: it reads as approved again, with its "Deleted from X" tag.
  if (post.postedAt || isOnPlatform(post.publication)) {
    return { key: 'published', label: 'Published', tone: 'success' }
  }
  if (publication === 'publishing') {
    return { key: 'publishing', label: 'Publishing', tone: 'brand', spinning: true }
  }
  if (publication === 'scheduled')
    return { key: 'scheduled', label: 'Scheduled', tone: 'brand' }
  if (post.status === 'approved' && publication === 'failed') {
    return { key: 'failed', label: 'Publish failed', tone: 'danger' }
  }
  if (post.status === 'approved') {
    return { key: 'approved', label: 'Approved', tone: 'info' }
  }
  if (post.status === 'rejected') {
    return { key: 'rejected', label: 'Rejected', tone: 'danger' }
  }
  if (post.status === 'draft') return { key: 'draft', label: 'Draft', tone: 'neutral' }
  return { key: 'awaiting_review', label: 'Awaiting review', tone: 'warning' }
}

/** The post's stage as a small coloured pill with a dot. */
export function PostStatusPill({
  post,
  size = 'sm',
  title,
  className
}: {
  post: PostDetail
  size?: 'xs' | 'sm' | 'md'
  title?: string
  className?: string
}) {
  const { label, tone, spinning } = postStage(post)
  return (
    <StatusChip
      tone={tone}
      spinning={spinning}
      size={size}
      title={title}
      className={className}
    >
      {label}
    </StatusChip>
  )
}

type StepKey = 'review' | 'approved' | 'scheduled' | 'published'

const STEP_LABELS: Record<StepKey, string> = {
  review: 'Review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published'
}

/** The stop each stage is at: going out, or failing to, is the Scheduled stop. */
const STEP_OF: Record<PostStageKey, StepKey> = {
  published: 'published',
  publishing: 'scheduled',
  scheduled: 'scheduled',
  failed: 'scheduled',
  approved: 'approved',
  rejected: 'review',
  draft: 'review',
  awaiting_review: 'review'
}

/**
 * The stops a post passes on its way out, and which one it is at. Scheduled
 * is a stop only where it applies: the post is scheduled (or publishing, or
 * that failed), went out on a schedule, or can still be scheduled because the
 * app publishes it. One published by hand or with Publish now never was.
 */
function postSteps(
  post: PostDetail,
  canSchedule: boolean
): { key: StepKey; state: 'done' | 'current' | 'todo' }[] {
  const current = STEP_OF[postStage(post).key]
  const wasScheduled =
    isOnPlatform(post.publication) && post.publication?.trigger !== 'manual'
  const withSchedule =
    current === 'scheduled' ||
    (current === 'published' ? wasScheduled : canSchedule)
  const keys: StepKey[] = withSchedule
    ? ['review', 'approved', 'scheduled', 'published']
    : ['review', 'approved', 'published']
  const at = keys.indexOf(current)
  return keys.map((key, i) => ({
    key,
    state: i < at ? 'done' : i === at ? 'current' : 'todo'
  }))
}

/**
 * Review → Approved → Scheduled → Published, with the post's own stage pill
 * at the stop it has reached. On a narrow screen the passed and coming stops
 * are dots; their names stay for screen readers.
 */
export function PostProgress({
  post,
  canSchedule,
  className
}: {
  post: PostDetail
  /** The app can publish this post, so scheduling it is a step ahead. */
  canSchedule: boolean
  className?: string
}) {
  const steps = postSteps(post, canSchedule)
  return (
    <ol
      aria-label="Where this post stands"
      className={cn('flex min-w-0 flex-wrap items-center gap-y-2', className)}
    >
      {steps.map((step, i) => (
        <li
          key={step.key}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className="flex items-center"
        >
          {i > 0 && (
            <span
              aria-hidden
              className={cn(
                'mx-1.5 h-px w-3 @lg:mx-2 @lg:w-6',
                step.state === 'todo' ? 'bg-border' : 'bg-foreground/30'
              )}
            />
          )}
          {step.state === 'current' ? (
            <PostStatusPill post={post} />
          ) : (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-xs font-medium',
                step.state === 'done' ? 'text-foreground' : 'text-muted'
              )}
            >
              {step.state === 'done' ? (
                <span
                  aria-hidden
                  className="bg-foreground/10 text-foreground flex h-4 w-4 items-center justify-center rounded-full"
                >
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              ) : (
                <span
                  aria-hidden
                  className="border-border h-4 w-4 rounded-full border-2 border-dashed"
                />
              )}
              <span className="sr-only @lg:not-sr-only">{STEP_LABELS[step.key]}</span>
              <span className="sr-only">
                {step.state === 'done' ? ', done' : ', not yet'}
              </span>
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

/**
 * When the post was deleted from its platform and has not gone out again
 * since (a new attempt waiting is fine; one publishing or published is not):
 * the time, for its red "Deleted from X" tag. Null otherwise.
 */
export function deletedFromPlatformAt(post: PostDetail): string | null {
  if (!post.deletedFromPlatformAt && !post.publication?.deletedAt) return null
  if (post.postedAt || isOnPlatform(post.publication)) return null
  if (post.publication?.status === 'publishing') return null
  return post.deletedFromPlatformAt ?? post.publication?.deletedAt ?? null
}

/** The red "Deleted from X" tag of a post deleted from its platform. */
export function DeletedFromPlatformTag({
  post,
  className
}: {
  post: PostDetail
  className?: string
}) {
  const at = deletedFromPlatformAt(post)
  if (!at) return null
  const name = getPlatform(post.platform).name
  return (
    <span
      title={`Deleted from ${name} on ${new Date(at).toLocaleString()}. It can be edited and published again.`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-rose-600 dark:text-rose-400',
        className
      )}
    >
      <Trash2 aria-hidden className="h-3 w-3" />
      Deleted from {name}
    </span>
  )
}
