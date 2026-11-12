'use client'

import { PlatformMark } from '@/components/platform-mark'
import {
  CONTENT_STYLES,
  PLATFORMS,
  STYLE_LABELS,
  type ContentStyle,
  type PlatformId
} from '@/lib/formats'

/**
 * How posts sound on each platform: Professional, Casual or Fun, one row per
 * platform. Used by identity setup and Preferences → Platforms.
 */
export function PlatformStyles({
  platforms,
  value,
  onChange,
  aiPicked,
  disabled = false
}: {
  platforms: PlatformId[]
  value: Partial<Record<PlatformId, ContentStyle>>
  onChange: (platform: PlatformId, style: ContentStyle) => void
  /** Platforms whose style is still the one the AI picked. */
  aiPicked?: ReadonlySet<PlatformId>
  disabled?: boolean
}) {
  return (
    <ul className="divide-border border-border divide-y rounded-lg border">
      {platforms.map(platform => {
        const label = PLATFORMS[platform].label
        const current = value[platform]
        return (
          <li
            key={platform}
            className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="text-foreground flex min-w-0 items-center gap-2 text-sm font-medium">
              <PlatformMark platform={platform} className="h-4 w-4 shrink-0" />
              {label}
              {aiPicked?.has(platform) && (
                <span className="bg-accent/10 text-accent rounded-full px-1.5 py-px text-[10px] font-semibold">
                  AI pick
                </span>
              )}
            </span>
            <StylePicker
              label={label}
              value={current}
              onChange={style => onChange(platform, style)}
              disabled={disabled}
            />
          </li>
        )
      })}
    </ul>
  )
}

/** Professional, Casual or Fun for one platform. */
export function StylePicker({
  label,
  value,
  onChange,
  disabled = false
}: {
  /** The platform's name, for screen readers. */
  label: string
  value: ContentStyle | undefined
  onChange: (style: ContentStyle) => void
  disabled?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`How posts sound on ${label}`}
      className="bg-surface-hover/60 inline-flex shrink-0 rounded-lg p-0.5"
    >
      {CONTENT_STYLES.map(style => {
        const selected = value === style
        return (
          <button
            key={style}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            title={STYLE_LABELS[style].hint}
            onClick={() => onChange(style)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:cursor-default ${
              selected
                ? 'bg-surface text-foreground shadow-xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {STYLE_LABELS[style].label}
          </button>
        )
      })}
    </div>
  )
}

/** What each style means, in one line, under the picker. */
export function StyleLegend() {
  return (
    <p className="text-muted text-xs leading-relaxed">
      {CONTENT_STYLES.map((style, i) => (
        <span key={style}>
          {i > 0 && ' · '}
          <span className="text-foreground font-medium">{STYLE_LABELS[style].label}</span>
          {': '}
          {STYLE_LABELS[style].hint.toLowerCase()}
        </span>
      ))}
    </p>
  )
}
