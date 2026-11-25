import {
  publishedOnLabel,
  type BlogDestinationId
} from '@/lib/blogs/destinations'
import {
  BLOG_STAGE_LABELS,
  type BlogGenerationStage,
  type BlogGenerationStatus,
  type BlogStatus
} from '@/lib/blogs/types'
import { cn } from '@/lib/cn'
import { Loader2 } from 'lucide-react'

/**
 * Where a blog stands, as a small chip: being written (with what it is
 * doing), stopped, failed, a draft or published (and where, when recorded).
 */
export function BlogStatusChip({
  status,
  generationStatus,
  generationStage,
  stale,
  hasText,
  publishedTo = null
}: {
  status: BlogStatus
  generationStatus: BlogGenerationStatus
  generationStage: BlogGenerationStage | null
  stale: boolean
  /** A failed regeneration leaves the text there: it is still a draft. */
  hasText: boolean
  /** Where a published blog went out, when that was recorded. */
  publishedTo?: BlogDestinationId | null
}) {
  const base =
    'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold'
  if (generationStatus === 'generating' && !stale) {
    return (
      <span className={cn(base, 'bg-brand/15 text-brand-strong')}>
        <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
        {generationStage ? BLOG_STAGE_LABELS[generationStage] : 'Starting'}…
      </span>
    )
  }
  if (generationStatus === 'generating' && stale) {
    return (
      <span
        className={cn(
          base,
          'bg-amber-500/15 text-amber-700 dark:text-amber-400'
        )}
      >
        Stopped
      </span>
    )
  }
  if (generationStatus === 'failed' && !hasText) {
    return (
      <span
        className={cn(base, 'bg-rose-500/15 text-rose-700 dark:text-rose-400')}
      >
        Failed
      </span>
    )
  }
  if (status === 'published') {
    return (
      <span
        className={cn(
          base,
          'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
        )}
      >
        {publishedOnLabel(publishedTo)}
      </span>
    )
  }
  return <span className={cn(base, 'bg-surface-hover text-muted')}>Draft</span>
}
