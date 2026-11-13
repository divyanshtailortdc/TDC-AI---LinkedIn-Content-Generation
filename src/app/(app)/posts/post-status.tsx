import { cn } from '@/lib/cn'
import { getPlatform } from '@/lib/platforms'
import { isOnPlatform } from '@/lib/publishing/status'
import { Trash2 } from 'lucide-react'
import type { PostDetail } from './posts-client'

type Tone = 'pending' | 'approved' | 'rejected' | 'live' | 'failed' | 'muted'

/**
 * Where a post stands, in a word: its review status, or once it is on its way
 * to its platform, how that is going. The list and the post page both show it.
 */
export function postStage(post: PostDetail): { label: string; tone: Tone } {
  const publication = post.publication?.status
  // Out on its platform (or marked posted). One deleted from its platform is
  // not: it reads as approved again, with its "Deleted from X" tag.
  if (post.postedAt || isOnPlatform(post.publication)) {
    return { label: 'Published', tone: 'live' }
  }
  if (publication === 'publishing') {
    return { label: 'Publishing', tone: 'approved' }
  }
  if (publication === 'scheduled')
    return { label: 'Scheduled', tone: 'approved' }
  if (post.status === 'approved' && publication === 'failed') {
    return { label: 'Publish failed', tone: 'failed' }
  }
  if (post.status === 'approved') return { label: 'Approved', tone: 'approved' }
  if (post.status === 'rejected') return { label: 'Rejected', tone: 'rejected' }
  if (post.status === 'draft') return { label: 'Draft', tone: 'muted' }
  return { label: 'Awaiting review', tone: 'pending' }
}

const TONE_CLASSES: Record<Tone, { pill: string; dot: string }> = {
  pending: {
    pill: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500'
  },
  approved: {
    pill: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
    dot: 'bg-indigo-500'
  },
  rejected: {
    pill: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
    dot: 'bg-rose-500'
  },
  live: {
    pill: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500'
  },
  failed: {
    pill: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
    dot: 'bg-rose-500'
  },
  muted: {
    pill: 'border-border bg-surface-hover text-muted',
    dot: 'bg-zinc-400'
  }
}

/** The post's stage as a small coloured pill with a dot. */
export function PostStatusPill({
  post,
  className
}: {
  post: PostDetail
  className?: string
}) {
  const { label, tone } = postStage(post)
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        TONE_CLASSES[tone].pill,
        className
      )}
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 rounded-full', TONE_CLASSES[tone].dot)}
      />
      {label}
    </span>
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
