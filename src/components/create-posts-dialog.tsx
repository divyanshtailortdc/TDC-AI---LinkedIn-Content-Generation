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
  supportsMediaFormat,
  type FormatId,
  type PlatformId
} from '@/lib/formats'
import { hasPostFor } from '@/lib/formats/drafted'
import { canPublishFormat } from '@/lib/publishing/platform'
import {
  describeVideoSpec,
  VIDEO_FORMATS,
  VIDEO_GENERATION_ENABLED,
  VIDEO_SPECS,
  type VideoFormatId
} from '@/lib/video/formats'
import {
  ArrowRight,
  Check,
  Clapperboard,
  GalleryHorizontal,
  Image as ImageIcon,
  Sparkles
} from 'lucide-react'
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
  imageByDefault = true,
  drafted,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  title: string
  description: React.ReactNode
  /** The formats ideation judged the ideas suit, marked as suggested. */
  suggested?: readonly string[]
  /**
   * For each idea posts are made from, the formats it already has posts in
   * (empty for one not drafted yet). A platform every one of them has a post
   * on is shown drafted and cannot be picked; one only some have is picked
   * for the others (src/lib/formats/drafted.ts).
   */
  drafted?: ReadonlyArray<readonly string[]>
  /** The formats the identity writes (resolveChannels): the only ones offered. */
  enabledFormats: readonly FormatId[]
  /** Picked when it opens (the platform whose ideas are shown); still changeable. */
  initialPlatforms?: readonly PlatformId[]
  /**
   * Whether "Add an image" starts ticked (it does unless told otherwise; a
   * post like a text-only one starts without). Still changeable.
   */
  imageByDefault?: boolean
  confirmLabel: string
  onCancel: () => void
  /**
   * The chosen formats, one per platform, in the registry's order, those of
   * them whose posts get an image ("Add an image"), and of those the ones
   * set to "Carousel" (the rest get a single image).
   */
  onConfirm: (
    formats: FormatId[],
    imageFormats: FormatId[],
    carouselFormats: FormatId[]
  ) => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const offered = CREATABLE_FORMATS.filter(f => enabledFormats.includes(f))
  const platforms = platformsOf(offered)
  const formatsOf = (platform: PlatformId) =>
    offered.filter(f => FORMATS[f].platform === platform)
  const isSuggested = (id: string) => suggested?.includes(id) ?? false

  // How many of the ideas already have a post of this format (a platform:
  // any post there that is not a video), and whether all of them do.
  const ideaCount = drafted?.length ?? 0
  const draftedCount = (format: FormatId) =>
    (drafted ?? []).filter(has => hasPostFor(format, has)).length
  const platformDraftedCount = (platform: PlatformId) =>
    draftedCount(formatsOf(platform)[0]!)
  const allDrafted = (count: number) => ideaCount > 0 && count === ideaCount

  // Picked at the start: the platform being viewed, or the only one there is.
  // One the identity no longer posts on is not offered, so not picked; nor
  // is one every idea already has a post on.
  const picked = (
    platforms.length === 1
      ? platforms
      : platforms.filter(p => initialPlatforms?.includes(p))
  ).filter(p => !allDrafted(platformDraftedCount(p)))
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
  const [noImage, setNoImage] = useState<PlatformId[]>(() =>
    imageByDefault ? [] : platforms
  )
  // The platforms whose image is a carousel of slides; a single image unless
  // picked here, so slides are never made without being asked for.
  const [carousel, setCarousel] = useState<PlatformId[]>([])
  const togglePlatform = (platform: PlatformId) => {
    if (chosen.includes(platform)) {
      setChosen(prev => prev.filter(p => p !== platform))
      setCarousel(prev => prev.filter(p => p !== platform))
      // Picked again, it starts as the dialog did: with an image, or without.
      setNoImage(prev => (imageByDefault ? prev.filter(p => p !== platform) : prev))
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

  // What to make: posts with an image (the steps below), or short videos.
  const [kind, setKind] = useState<'image' | 'video'>('image')
  const [videos, setVideos] = useState<VideoFormatId[]>([])
  const toggleVideo = (id: VideoFormatId) =>
    setVideos(prev =>
      prev.includes(id)
        ? prev.filter(v => v !== id)
        : VIDEO_FORMATS.filter(v => v === id || prev.includes(v))
    )

  const missingType = chosen.find(p => !types[p])
  const ready =
    kind === 'video' ? videos.length > 0 : chosen.length > 0 && !missingType
  const formats = chosen.flatMap(p => (types[p] ? [types[p]!] : []))
  const imageFormats = formats.filter(
    f =>
      canHaveImage(f) &&
      (needsImage(f) || !noImage.includes(FORMATS[f].platform))
  )
  const carouselFormats = imageFormats.filter(
    f =>
      carousel.includes(FORMATS[f].platform) && supportsMediaFormat(f, 'carousel')
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
          {/* Short video is switched off for now (VIDEO_GENERATION_ENABLED). */}
          {VIDEO_GENERATION_ENABLED && (
            <KindChoice value={kind} onChange={setKind} />
          )}
          {kind === 'video' ? (
            <VideoChoice
              chosen={videos}
              onToggle={toggleVideo}
              draftedCount={draftedCount}
              ideaCount={ideaCount}
            />
          ) : (
          <>
          <fieldset>
            <legend className="text-foreground mb-2 text-xs font-semibold">
              1. Platform
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {platforms.map(platform => {
                const on = chosen.includes(platform)
                const draftedHere = platformDraftedCount(platform)
                const done = allDrafted(draftedHere)
                return (
                  <button
                    key={platform}
                    type="button"
                    aria-pressed={on}
                    disabled={done}
                    onClick={() => togglePlatform(platform)}
                    data-platform={platform}
                    title={
                      done
                        ? `Already drafted for ${PLATFORMS[platform].label}`
                        : undefined
                    }
                    className={cn(
                      'relative flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
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
                      {done ? (
                        <span className="text-muted block text-[10px] font-semibold uppercase">
                          Already drafted
                        </span>
                      ) : draftedHere > 0 ? (
                        <span className="text-muted block text-[10px] font-semibold">
                          Drafted for {draftedHere} of {ideaCount}
                        </span>
                      ) : (
                        formatsOf(platform).some(isSuggested) && (
                          <span className="text-accent block text-[10px] font-semibold uppercase">
                            Suggested
                          </span>
                        )
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
                ? 'Pick one or more. Each idea gets a post on every platform you pick that it has no post on yet. '
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
                      carousel={carousel.includes(platform)}
                      onCarouselChange={on =>
                        setCarousel(prev =>
                          on
                            ? [...prev.filter(p => p !== platform), platform]
                            : prev.filter(p => p !== platform)
                        )
                      }
                    />
                  )}
                  </div>
                ))}
              </div>
            )}
          </fieldset>
          </>
          )}
        </div>

        <div className="border-border flex flex-wrap items-center justify-end gap-2 border-t px-6 py-4">
          <p
            aria-live="polite"
            className="text-muted mr-auto min-w-0 text-[11px] leading-snug"
          >
            {kind === 'video'
              ? videos.length === 0
                ? 'Pick where the video goes.'
                : `${videos.map(v => FORMATS[v].label).join(', ')}: script now, video on the post page.`
              : chosen.length === 0
              ? 'Pick a platform.'
              : missingType
                ? `Pick the type of ${PLATFORMS[missingType].label} post.`
                : `${formats
                    .map(
                      f =>
                        `${FORMATS[f].label}${
                          carouselFormats.includes(f)
                            ? ' with carousel'
                            : imageFormats.includes(f)
                              ? ' with image'
                              : ''
                        }`
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
            onClick={() =>
              kind === 'video'
                ? onConfirm([...videos], [], [])
                : onConfirm(formats, imageFormats, carouselFormats)
            }
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

/** What to make: an image post (the platform and type steps) or a short video. */
function KindChoice({
  value,
  onChange
}: {
  value: 'image' | 'video'
  onChange: (value: 'image' | 'video') => void
}) {
  const options = [
    { value: 'image', label: 'Image post', Icon: ImageIcon },
    { value: 'video', label: 'Short video', Icon: Clapperboard }
  ] as const
  return (
    <div
      role="radiogroup"
      aria-label="What to make"
      className="border-border bg-surface grid grid-cols-2 rounded-xl border p-1"
    >
      {options.map(({ value: option, label, Icon }) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            value === option
              ? 'bg-accent text-background shadow-xs'
              : 'text-muted hover:bg-surface-hover hover:text-foreground'
          )}
        >
          <Icon aria-hidden className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * Short video: where it goes. Each pick drafts a script now, and its
 * vertical video is recorded from the script as soon as it is written.
 * Offered whatever the identity turned on in Preferences.
 */
function VideoChoice({
  chosen,
  onToggle,
  draftedCount,
  ideaCount
}: {
  chosen: readonly VideoFormatId[]
  onToggle: (id: VideoFormatId) => void
  /** How many of the ideas already have this Reel or Short. */
  draftedCount: (id: VideoFormatId) => number
  ideaCount: number
}) {
  return (
    <fieldset>
      <legend className="text-foreground mb-2 text-xs font-semibold">
        Platform
      </legend>
      <div className="space-y-1.5">
        {VIDEO_FORMATS.map(id => {
          const spec = VIDEO_SPECS[id]
          const on = chosen.includes(id)
          const draftedHere = draftedCount(id)
          const done = ideaCount > 0 && draftedHere === ideaCount
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              disabled={done}
              onClick={() => onToggle(id)}
              data-platform={spec.platform}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                on ? 'border-brand/50 bg-brand/5' : 'border-border hover:bg-surface-hover'
              )}
            >
              <PlatformMark
                platform={spec.platform}
                className={cn('h-4 w-4 shrink-0', on ? 'text-foreground' : 'text-muted')}
              />
              <span className="min-w-0 flex-1">
                <span className="text-foreground block text-sm font-medium">{spec.label}</span>
                <span className="text-muted block text-[11px]">
                  {done
                    ? 'Already drafted'
                    : draftedHere > 0
                      ? `Drafted for ${draftedHere} of ${ideaCount} · ${describeVideoSpec(spec)}`
                      : describeVideoSpec(spec)}
                </span>
              </span>
              {on && <Check aria-hidden className="text-brand h-4 w-4 shrink-0" />}
            </button>
          )
        })}
      </div>
      <p className="text-muted mt-2 text-[11px] leading-relaxed">
        Pick one or more. Each idea gets a short script for every platform you
        pick, and its video, the script as slides, starts as soon as the script
        is written. Approve the post, then publish it from its page.
      </p>
      <p className="text-muted mt-2 text-[11px] leading-relaxed">
        Recorded on the server in your Brand Theme and, where it leaves
        something unset, the look of your own posts. Matching that look costs
        about a cent, once per platform.
      </p>
    </fieldset>
  )
}

/**
 * "Add an image" under a platform's post types: the image is designed with
 * the post. Ticked by default; always on (and locked) for a post that is a
 * picture, such as an Instagram post. With an image, a post type that takes
 * slides asks which: one image (the default) or a carousel.
 */
function ImageChoice({
  formatId,
  on,
  onChange,
  carousel,
  onCarouselChange
}: {
  formatId: FormatId
  on: boolean
  onChange: (on: boolean) => void
  carousel: boolean
  onCarouselChange: (carousel: boolean) => void
}) {
  const required = needsImage(formatId)
  const withImage = required || on
  const label = PLATFORMS[FORMATS[formatId].platform].label
  const options = [
    { carousel: false, label: 'Single image', Icon: ImageIcon },
    { carousel: true, label: 'Carousel', Icon: GalleryHorizontal }
  ] as const
  return (
    <div className="mt-2 space-y-2">
      <label
        className={cn(
          'flex items-center gap-2.5 px-1 text-xs',
          required ? 'cursor-default' : 'cursor-pointer'
        )}
      >
        <input
          type="checkbox"
          checked={withImage}
          disabled={required}
          onChange={e => onChange(e.target.checked)}
          className="accent-accent h-4 w-4 shrink-0"
        />
        <ImageIcon aria-hidden className="text-muted h-3.5 w-3.5 shrink-0" />
        <span className="text-foreground font-medium">Add an image</span>
        {required && <span className="text-muted">· {label} posts need one</span>}
      </label>
      {withImage && supportsMediaFormat(formatId, 'carousel') && (
        <div
          role="radiogroup"
          aria-label={`${label} image type`}
          className="border-border ml-6.5 inline-grid grid-cols-2 rounded-lg border p-0.5"
        >
          {options.map(option => {
            const active = carousel === option.carousel
            return (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onCarouselChange(option.carousel)}
                className={cn(
                  'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  active
                    ? 'bg-accent text-background shadow-xs'
                    : 'text-muted hover:bg-surface-hover hover:text-foreground'
                )}
              >
                <option.Icon aria-hidden className="h-3.5 w-3.5" />
                {option.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
