import { cn } from '@/lib/cn'
import { FORMATS, isCreatableFormat, isFormatId } from '@/lib/formats'
import { isVideoFormat } from '@/lib/video/formats'

/** One post format as a small label, e.g. "X thread". */
export function FormatBadge({
  formatId,
  className
}: {
  formatId: string | null | undefined
  className?: string
}) {
  const id = isFormatId(formatId) ? formatId : 'linkedin.post'
  return (
    <span
      className={cn(
        'border-border text-muted inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-semibold whitespace-nowrap',
        className
      )}
    >
      {FORMATS[id].label}
    </span>
  )
}

/** The formats an idea suits, e.g. on its card: "Suits LinkedIn post · X thread". */
export function FormatChips({
  formats,
  label = 'Suits',
  withVideos = false
}: {
  formats: string[] | null | undefined
  label?: string
  /** Reels and Shorts too (the posts an idea has), not only creatable formats. */
  withVideos?: boolean
}) {
  // Only formats a post can still be created in (and videos, when asked).
  const known = (formats ?? [])
    .filter(isFormatId)
    .filter(f => isCreatableFormat(f) || (withVideos && isVideoFormat(f)))
  if (known.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-muted text-[11px]">{label}</span>
      {known.map(id => (
        <FormatBadge key={id} formatId={id} />
      ))}
    </div>
  )
}
