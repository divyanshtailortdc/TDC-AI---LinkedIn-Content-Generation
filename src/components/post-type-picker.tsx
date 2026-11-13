'use client'

import {
  MEDIA_FORMAT_HINTS,
  MEDIA_FORMAT_LABELS,
  MEDIA_FORMATS,
  mediaFormatsOf,
  type FormatId,
  type MediaFormat
} from '@/lib/formats'
import {
  Clapperboard,
  Image as ImageIcon,
  Layers,
  Loader2,
  Type
} from 'lucide-react'

/**
 * What goes out with a post's text, picked per post among what its format
 * takes: text only, a single image, or a carousel. A video script is always
 * a video, so it shows as a label.
 */

const ICONS = {
  text: Type,
  image: ImageIcon,
  carousel: Layers,
  video: Clapperboard
} as const

export function PostTypePicker({
  formatId,
  value,
  onChange,
  disabled,
  pending
}: {
  formatId: FormatId
  value: MediaFormat
  onChange: (value: MediaFormat) => void
  disabled?: boolean
  /** The type being switched to, while it is saved or its slides are made. */
  pending?: MediaFormat | null
}) {
  const options = MEDIA_FORMATS.filter(f =>
    mediaFormatsOf(formatId).includes(f)
  )
  if (options.length <= 1) {
    const only = options[0] ?? value
    const Icon = ICONS[only]
    return (
      <span className="text-muted inline-flex items-center gap-1.5 text-xs font-medium">
        <Icon className="h-3.5 w-3.5" />
        {MEDIA_FORMAT_LABELS[only]}
      </span>
    )
  }
  return (
    <div
      role="radiogroup"
      aria-label="Post type"
      className="border-border bg-surface inline-flex rounded-lg border p-0.5"
    >
      {options.map(option => {
        const Icon = pending === option ? Loader2 : ICONS[option]
        const selected = option === value
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            title={MEDIA_FORMAT_HINTS[option]}
            onClick={() => !selected && onChange(option)}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? 'bg-accent text-background shadow-xs'
                : 'text-muted hover:bg-surface-hover hover:text-foreground'
            }`}
          >
            <Icon
              className={`h-3.5 w-3.5 ${pending === option ? 'animate-spin' : ''}`}
            />
            {MEDIA_FORMAT_LABELS[option]}
          </button>
        )
      })}
    </div>
  )
}
