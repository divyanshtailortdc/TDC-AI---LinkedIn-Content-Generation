'use client'

import { PlatformMark } from '@/components/platform-mark'
import { cn } from '@/lib/cn'
import {
  canHaveImage,
  CREATABLE_FORMATS,
  FORMATS,
  formatHint,
  needsImage,
  PLATFORMS,
  platformsOf,
  type FormatId,
  type PlatformId
} from '@/lib/formats'
import { canPublishFormat } from '@/lib/publishing/platform'
import { ArrowRight, Check, Image as ImageIcon, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Asked every time posts are created from ideas: first the platforms the
 * posts are for, then the type of post on each (an X post or a thread).
 * Create stays disabled until every chosen platform has its type. A platform
 * with one type (a LinkedIn post, an Instagram post) has it chosen with the
 * platform. Only the formats the identity turned on in Identity →
 * Preferences are offered, so an identity set up for Instagram alone is
 * asked about Instagram alone (and has it picked already).
 */
export function CreatePostsDialog({
  title,
  description,
  suggested,
  enabledFormats,
  initialPlatforms,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  title: string
  description: React.ReactNode
  /** The formats ideation judged the ideas suit, marked as suggested. */
  suggested?: readonly string[]
  /** The formats the identity writes (resolveChannels): the only ones offered. */
  enabledFormats: readonly FormatId[]
  /** Picked when it opens (the platform whose ideas are shown); still changeable. */
  initialPlatforms?: readonly PlatformId[]
  confirmLabel: string
  onCancel: () => void
  /**
   * The chosen formats, one per platform, in the registry's order, and those
   * of them whose posts get an image ("Add an image").
   */
  onConfirm: (formats: FormatId[], imageFormats: FormatId[]) => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const offered = CREATABLE_FORMATS.filter(f => enabledFormats.includes(f))
  const platforms = platformsOf(offered)
  const formatsOf = (platform: PlatformId) =>
    offered.filter(f => FORMATS[f].platform === platform)
  const isSuggested = (id: string) => suggested?.includes(id) ?? false

  // Picked at the start: the platform being viewed, or the only one there is.
  // One the identity no longer posts on is not offered, so not picked.
  const picked =
    platforms.length === 1
      ? platforms
      : platforms.filter(p => initialPlatforms?.includes(p))
  const [chosen, setChosen] = useState<PlatformId[]>(picked)
  // A platform picked at the start with one type has it chosen too.
  const [types, setTypes] = useState<Partial<Record<PlatformId, FormatId>>>(() =>
    Object.fromEntries(
      picked
        .flatMap(p => {
          const only = formatsOf(p)
          return only.length === 1 ? [[p, only[0]!]] : []
        })
    )
  )
  const [noImage, setNoImage] = useState<PlatformId[]>([])
  const togglePlatform = (platform: PlatformId) => {
    if (chosen.includes(platform)) {
      setChosen(prev => prev.filter(p => p !== platform))
      setNoImage(prev => prev.filter(p => p !== platform))
      setTypes(prev => {
        const next = { ...prev }
        delete next[platform]
        return next
      })
      return
    }
    setChosen(prev => platforms.filter(p => p === platform || prev.includes(p)))
    // Nothing to choose between: the platform's one type comes with it.
    const only = formatsOf(platform)
    if (only.length === 1) setTypes(prev => ({ ...prev, [platform]: only[0] }))
  }

  const missingType = chosen.find(p => !types[p])
  const ready = chosen.length > 0 && !missingType
  const formats = chosen.flatMap(p => (types[p] ? [types[p]!] : []))
  const imageFormats = formats.filter(
    f =>
      canHaveImage(f) &&
      (needsImage(f) || !noImage.includes(FORMATS[f].platform))
  )

  // Modal: the page behind must not act on its keys. Listening in the capture
  // phase runs before the page's own listeners (as ConfirmDialog does);
  // nothing is prevented, so Tab, Space and Enter still work in the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs motion-safe:animate-[overlay-in_150ms_ease-out]"
      onClick={e => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="border-border bg-surface flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-2xl border shadow-xl motion-safe:animate-[dialog-in_200ms_cubic-bezier(0.16,1,0.3,1)]"
      >
        <div className="border-border border-b px-6 pt-5 pb-4">
          <h2
            id={titleId}
            className="text-foreground flex items-center gap-2 text-sm font-semibold"
          >
            <Sparkles aria-hidden className="text-brand h-4 w-4" />
            {title}
          </h2>
          <p
            id={descriptionId}
            className="text-muted mt-1 text-xs leading-relaxed"
          >
            {description}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
          <fieldset>
            <legend className="text-foreground mb-2 text-xs font-semibold">
              1. Platform
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {platforms.map(platform => {
                const on = chosen.includes(platform)
                return (
                  <button
                    key={platform}
                    type="button"
                    aria-pressed={on}
                    onClick={() => togglePlatform(platform)}
                    data-platform={platform}
                    className={cn(
                      'relative flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      on
                        ? 'border-brand/50 bg-brand/5'
                        : 'border-border hover:bg-surface-hover'
                    )}
                  >
                    <PlatformMark
                      platform={platform}
                      className={cn(
                        'h-4 w-4 shrink-0',
                        on ? 'text-foreground' : 'text-muted'
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block text-sm font-medium">
                        {PLATFORMS[platform].label}
                      </span>
                      {formatsOf(platform).some(isSuggested) && (
                        <span className="text-accent block text-[10px] font-semibold uppercase">
                          Suggested
                        </span>
                      )}
                    </span>
                    {on && (
                      <Check aria-hidden className="text-brand h-4 w-4 shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
            <p className="text-muted mt-2 text-[11px] leading-relaxed">
              {platforms.length > 1
                ? 'Pick one or more. Each idea gets a post on every platform you pick. '
                : ''}
              Other platforms are turned on under{' '}
              <Link
                href="/identity/preferences"
                className="text-accent hover:underline"
              >
                Identity → Preferences
              </Link>
              .
            </p>
          </fieldset>

          <fieldset disabled={chosen.length === 0}>
            <legend className="text-foreground mb-2 text-xs font-semibold">
              2. Type of post
            </legend>
            {chosen.length === 0 ? (
              <p className="border-border text-muted rounded-xl border border-dashed px-4 py-3 text-center text-xs">
                Pick a platform first.
              </p>
            ) : (
              <div className="space-y-4">
                {chosen.map(platform => (
                  <div key={platform}>
                  <div role="radiogroup" aria-label={`${PLATFORMS[platform].label} post type`}>
                    {chosen.length > 1 && (
                      <p className="text-muted mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase">
                        <PlatformMark platform={platform} className="h-3 w-3" />
                        {PLATFORMS[platform].label}
                      </p>
                    )}
                    <div className="space-y-1.5">
                      {formatsOf(platform).map(id => {
                        const on = types[platform] === id
                        return (
                          <label
                            key={id}
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                              on
                                ? 'border-brand/50 bg-brand/5'
                                : 'border-border hover:bg-surface-hover'
                            )}
                          >
                            <input
                              type="radio"
                              name={`${titleId}-${platform}`}
                              checked={on}
                              onChange={() =>
                                setTypes(prev => ({ ...prev, [platform]: id }))
                              }
                              className="accent-accent mt-0.5 h-4 w-4 shrink-0"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="text-foreground text-sm font-medium">
                                  {FORMATS[id].label}
                                </span>
                                {isSuggested(id) && (
                                  <span className="bg-accent/10 text-accent rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase">
                                    Suggested
                                  </span>
                                )}
                              </span>
                              <span className="text-muted mt-0.5 block text-[11px] leading-snug">
                                {formatHint(id)}
                                {' · '}
                                {canPublishFormat(platform, id)
                                  ? 'Publish or schedule it from here'
                                  : 'Copy it and post it by hand'}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                  {/* Once its type is chosen: an image with the post or not */}
                  {types[platform] && canHaveImage(types[platform]!) && (
                    <ImageChoice
                      formatId={types[platform]!}
                      on={!noImage.includes(platform)}
                      onChange={on =>
                        setNoImage(prev =>
                          on
                            ? prev.filter(p => p !== platform)
                            : [...prev, platform]
                        )
                      }
                    />
                  )}
                  </div>
                ))}
              </div>
            )}
          </fieldset>
        </div>

        <div className="border-border flex flex-wrap items-center justify-end gap-2 border-t px-6 py-4">
          <p
            aria-live="polite"
            className="text-muted mr-auto min-w-0 text-[11px] leading-snug"
          >
            {chosen.length === 0
              ? 'Pick a platform.'
              : missingType
                ? `Pick the type of ${PLATFORMS[missingType].label} post.`
                : `${formats
                    .map(
                      f =>
                        `${FORMATS[f].label}${imageFormats.includes(f) ? ' with image' : ''}`
                    )
                    .join(', ')}.`}
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border px-3.5 text-[13px] font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => onConfirm(formats, imageFormats)}
            className="bg-accent text-background hover:bg-accent-hover inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles aria-hidden className="h-3.5 w-3.5" />
            {confirmLabel}
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/**
 * "Add an image" under a platform's post types: the image is designed with
 * the post. Ticked by default; always on (and locked) for a post that is a
 * picture, such as an Instagram post.
 */
function ImageChoice({
  formatId,
  on,
  onChange
}: {
  formatId: FormatId
  on: boolean
  onChange: (on: boolean) => void
}) {
  const required = needsImage(formatId)
  return (
    <label
      className={cn(
        'mt-2 flex items-center gap-2.5 px-1 text-xs',
        required ? 'cursor-default' : 'cursor-pointer'
      )}
    >
      <input
        type="checkbox"
        checked={required || on}
        disabled={required}
        onChange={e => onChange(e.target.checked)}
        className="accent-accent h-4 w-4 shrink-0"
      />
      <ImageIcon aria-hidden className="text-muted h-3.5 w-3.5 shrink-0" />
      <span className="text-foreground font-medium">Add an image</span>
      {required && (
        <span className="text-muted">
          · {PLATFORMS[FORMATS[formatId].platform].label} posts need one
        </span>
      )}
    </label>
  )
}
