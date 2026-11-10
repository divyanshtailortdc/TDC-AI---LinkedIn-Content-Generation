import { cn } from '@/lib/cn'
import { FORMATS, isFormatId } from '@/lib/formats'

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
  label = 'Suits'
}: {
  formats: string[] | null | undefined
  label?: string
}) {
  const known = (formats ?? []).filter(isFormatId)
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
