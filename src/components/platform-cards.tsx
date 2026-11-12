'use client'

import { PlatformMark } from '@/components/platform-mark'
import { StylePicker } from '@/components/platform-styles'
import {
  EMOJI_LABELS,
  EMOJI_LEVELS,
  isCasualStyle,
  isEmojiLevel,
  PLATFORMS,
  type ContentStyle,
  type EmojiLevel,
  type PlatformId
} from '@/lib/formats'
import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'

/** What a platform's card holds besides its style. */
export type PlatformCardNote = {
  audience?: string
  tone?: string
  emoji?: EmojiLevel
}

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors'

/**
 * Each platform as a card: its style, and for every platform but LinkedIn
 * who follows the identity there, how it sounds and how freely it uses emoji.
 * One line sums the details up and Edit opens them, so a review is a glance
 * and a change is one click. LinkedIn takes these from the profile and voice.
 */
export function PlatformCards({
  platforms,
  styles,
  notes,
  onStyleChange,
  onNoteChange,
  aiPicked
}: {
  platforms: PlatformId[]
  styles: Partial<Record<PlatformId, ContentStyle>>
  notes: Partial<Record<PlatformId, PlatformCardNote>>
  onStyleChange: (platform: PlatformId, style: ContentStyle) => void
  onNoteChange: (platform: PlatformId, note: PlatformCardNote) => void
  /** Platforms whose settings are still the ones the AI suggested. */
  aiPicked?: ReadonlySet<PlatformId>
}) {
  return (
    <ul className="space-y-2">
      {platforms.map(platform => (
        <PlatformCard
          key={platform}
          platform={platform}
          style={styles[platform]}
          note={notes[platform] ?? {}}
          onStyleChange={style => onStyleChange(platform, style)}
          onNoteChange={note => onNoteChange(platform, note)}
          aiPicked={aiPicked?.has(platform) ?? false}
        />
      ))}
    </ul>
  )
}

function PlatformCard({
  platform,
  style,
  note,
  onStyleChange,
  onNoteChange,
  aiPicked
}: {
  platform: PlatformId
  style: ContentStyle | undefined
  note: PlatformCardNote
  onStyleChange: (style: ContentStyle) => void
  onNoteChange: (note: PlatformCardNote) => void
  aiPicked: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const label = PLATFORMS[platform].label
  const hasDetails = platform !== 'linkedin'
  const casual = style !== undefined && isCasualStyle(style)
  const defaultEmoji = casual ? EMOJI_LABELS.liberal : 'same as your Voice'

  const summary = hasDetails
    ? [
        `Emoji: ${note.emoji ? EMOJI_LABELS[note.emoji] : `default (${defaultEmoji})`}`,
        note.audience && `For: ${note.audience}`,
        note.tone && `Sounds: ${note.tone}`
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Uses your profile and voice.'

  return (
    <li className="border-border bg-surface rounded-lg border">
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-foreground flex min-w-0 items-center gap-2 text-sm font-medium">
          <PlatformMark platform={platform} className="h-4 w-4 shrink-0" />
          {label}
          {aiPicked && (
            <span className="bg-accent/10 text-accent rounded-full px-1.5 py-px text-[10px] font-semibold">
              AI pick
            </span>
          )}
        </span>
        <StylePicker label={label} value={style} onChange={onStyleChange} />
      </div>

      <div className="border-border flex items-start gap-3 border-t px-3 py-2">
        <p className="text-muted min-w-0 flex-1 truncate text-xs leading-relaxed" title={summary}>
          {summary}
        </p>
        {hasDetails && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-details`}
            onClick={() => setOpen(o => !o)}
            className="text-accent hover:text-accent-hover inline-flex shrink-0 items-center gap-1 text-xs font-medium"
          >
            {open ? 'Done' : 'Edit'}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>

      {hasDetails && open && (
        <div id={`${id}-details`} className="border-border space-y-3 border-t px-3 py-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label
                htmlFor={`${id}-audience`}
                className="text-foreground mb-1 block text-xs font-medium"
              >
                Who follows you on {label}
              </label>
              <textarea
                id={`${id}-audience`}
                autoComplete="off"
                value={note.audience ?? ''}
                onChange={e => onNoteChange({ ...note, audience: e.target.value })}
                placeholder="e.g. Locals and regulars who come for the seasonal bakes"
                className={`${inputClass} h-20 resize-none leading-relaxed`}
              />
            </div>
            <div className="min-w-0">
              <label
                htmlFor={`${id}-tone`}
                className="text-foreground mb-1 block text-xs font-medium"
              >
                How you sound on {label}
              </label>
              <textarea
                id={`${id}-tone`}
                autoComplete="off"
                value={note.tone ?? ''}
                onChange={e => onNoteChange({ ...note, tone: e.target.value })}
                placeholder="e.g. Warm and chatty, first names, behind the scenes"
                className={`${inputClass} h-20 resize-none leading-relaxed`}
              />
            </div>
          </div>
          <div className="sm:w-1/2 sm:pr-1.5">
            <label
              htmlFor={`${id}-emoji`}
              className="text-foreground mb-1 block text-xs font-medium"
            >
              Emoji on {label}
            </label>
            <select
              id={`${id}-emoji`}
              value={note.emoji ?? ''}
              onChange={e =>
                onNoteChange({
                  ...note,
                  emoji: isEmojiLevel(e.target.value) ? e.target.value : undefined
                })
              }
              className={inputClass}
            >
              <option value="">Default ({defaultEmoji})</option>
              {EMOJI_LEVELS.map(level => (
                <option key={level} value={level}>
                  {EMOJI_LABELS[level]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </li>
  )
}
