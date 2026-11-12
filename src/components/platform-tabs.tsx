'use client'

import { PlatformMark } from '@/components/platform-mark'
import { getPlatform, type PlatformId } from '@/lib/platforms'
import { LayoutGrid } from 'lucide-react'

/** A platform's own colour on its tab when picked. */
const PLATFORM_TINTS: Partial<Record<PlatformId, { tab: string; count: string }>> = {
  linkedin: {
    tab: 'border-[#0a66c2]/60 bg-[#0a66c2]/10',
    count: 'bg-[#0a66c2]/20 text-foreground'
  },
  instagram: {
    tab: 'border-[#e1306c]/60 bg-[#e1306c]/10',
    count: 'bg-[#e1306c]/20 text-foreground'
  },
  facebook: {
    tab: 'border-[#1877f2]/60 bg-[#1877f2]/10',
    count: 'bg-[#1877f2]/20 text-foreground'
  },
  youtube: {
    tab: 'border-[#ff0033]/60 bg-[#ff0033]/10',
    count: 'bg-[#ff0033]/20 text-foreground'
  }
}
const NEUTRAL_TINT = {
  tab: 'border-foreground/30 bg-surface-hover',
  count: 'bg-foreground/10 text-foreground'
}

/** A tab's name: X keeps its old name beside the new one, so it is recognised. */
const tabName = (platform: PlatformId) =>
  platform === 'x' ? 'Twitter/X' : getPlatform(platform).name

/**
 * One platform's items, or every platform's: the tabs above Posts and Ideas,
 * so both pages narrow by platform the same way. The picked tab takes the
 * platform's colour; each tab can show how many items it holds.
 */
export function PlatformTabs({
  options,
  value,
  onChange,
  counts,
  label,
  allLabel = 'All platforms'
}: {
  /** The platforms to offer, in order; "All" comes first. */
  options: PlatformId[]
  /** The platform shown; null for every platform. */
  value: PlatformId | null
  onChange: (next: PlatformId | null) => void
  /** How many items each tab holds; left out, no counts are shown. */
  counts?: { all: number; byPlatform: Partial<Record<PlatformId, number>> }
  /** What the tabs narrow, for screen readers ("Show posts for one platform"). */
  label: string
  allLabel?: string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {[null, ...options].map(option => {
        const active = value === option
        const tint = option ? (PLATFORM_TINTS[option] ?? NEUTRAL_TINT) : NEUTRAL_TINT
        const count = counts
          ? option
            ? (counts.byPlatform[option] ?? 0)
            : counts.all
          : null
        return (
          <button
            key={option ?? 'all'}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={`flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors ${
              active
                ? `${tint.tab} text-foreground font-semibold`
                : 'border-border bg-surface text-muted hover:text-foreground hover:bg-surface-hover'
            }`}
          >
            {option ? (
              <PlatformMark platform={option} colored className="h-4 w-4 shrink-0" />
            ) : (
              <LayoutGrid className="h-4 w-4 shrink-0" />
            )}
            {option ? tabName(option) : allLabel}
            {count !== null && (
              <span
                className={`rounded-md px-1.5 text-[11px] leading-5 font-medium tabular-nums ${
                  active ? tint.count : 'bg-surface-hover text-muted'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
