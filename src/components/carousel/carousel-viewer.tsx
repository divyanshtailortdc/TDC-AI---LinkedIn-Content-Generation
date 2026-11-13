'use client'

import type { PlatformId } from '@/lib/platforms'
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  ImageOff,
  Loader2
} from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

/**
 * A carousel post's slides as its platform shows them, swipeable: Instagram
 * one slide at a time with dots under it, LinkedIn as a document with a page
 * counter, Facebook as the photo grid its feed shows (opened, they swipe).
 * Scroll snapping does the swiping, so touch, trackpad and the arrow buttons
 * all move it; the slide in view is reported for the slide editor to follow.
 */

export interface ViewerSlide {
  id: string
  position: number
  imageUrl: string | null
  altText: string
  status: 'ready' | 'failed'
}

interface CarouselViewerProps {
  slides: ViewerSlide[]
  platform: PlatformId
  /** A document post's title, shown over it on LinkedIn. */
  title?: string
  /** The slide in view, when the page follows it (0-based). */
  index?: number
  onIndexChange?: (index: number) => void
  /** Opens a slide (zoom). */
  onOpen?: (index: number) => void
  /** Slides are still being made or loaded. */
  loading?: boolean
  /** Why the slides could not be loaded; they exist, so they are not "missing". */
  error?: string | null
}

export function CarouselViewer(props: CarouselViewerProps) {
  if (props.loading && props.slides.length === 0) {
    return (
      <div className="dark:bg-surface-hover flex aspect-4/5 max-h-[min(34rem,60vh)] w-full flex-col items-center justify-center gap-2 bg-neutral-100 text-xs text-neutral-500 dark:text-neutral-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading slides…
      </div>
    )
  }
  if (props.slides.length === 0) {
    return (
      <div className="dark:bg-surface-hover flex aspect-4/5 max-h-[min(34rem,60vh)] w-full flex-col items-center justify-center gap-2 bg-neutral-100 p-6 text-center text-xs text-neutral-500 dark:text-neutral-400">
        <ImageOff className="h-6 w-6" />
        <span className="font-semibold">
          {props.error ? 'The slides could not be loaded' : 'No slides yet'}
        </span>
        <span>
          {props.error
            ? 'Try again from the Slides panel.'
            : 'Make the carousel in the Slides panel.'}
        </span>
      </div>
    )
  }
  if (props.platform === 'facebook') return <FacebookGrid {...props} />
  return <Swiper {...props} />
}

function SlideImage({ slide, eager }: { slide: ViewerSlide; eager?: boolean }) {
  if (!slide.imageUrl) {
    return (
      <div className="dark:bg-surface-hover flex h-full w-full flex-col items-center justify-center gap-1 bg-neutral-100 text-[11px] text-neutral-500">
        <ImageOff className="h-5 w-5" />
        {slide.status === 'failed' ? 'Not drawn' : 'Loading…'}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={slide.imageUrl}
      alt={slide.altText || `Slide ${slide.position}`}
      loading={eager ? 'eager' : 'lazy'}
      draggable={false}
      className="h-full w-full object-cover select-none"
    />
  )
}

function Swiper({
  slides,
  platform,
  title,
  index: controlled,
  onIndexChange,
  onOpen
}: CarouselViewerProps) {
  const track = useRef<HTMLDivElement>(null)
  const [own, setOwn] = useState(0)
  const index = Math.min(controlled ?? own, slides.length - 1)
  const isDocument = platform === 'linkedin'

  // Follows the page: a slide picked in the editor scrolls into view.
  useEffect(() => {
    const el = track.current
    if (!el) return
    const target = index * el.clientWidth
    if (Math.abs(el.scrollLeft - target) > 4)
      el.scrollTo({ left: target, behavior: 'smooth' })
  }, [index])

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(slides.length - 1, next))
    setOwn(clamped)
    onIndexChange?.(clamped)
    track.current?.scrollTo({
      left: clamped * track.current.clientWidth,
      behavior: 'smooth'
    })
  }

  const onScroll = () => {
    const el = track.current
    if (!el || el.clientWidth === 0) return
    const current = Math.round(el.scrollLeft / el.clientWidth)
    if (current !== index) {
      setOwn(current)
      onIndexChange?.(current)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') go(index + 1)
    if (event.key === 'ArrowLeft') go(index - 1)
  }

  return (
    <div className="w-full">
      {isDocument && (
        <div className="dark:border-border dark:bg-surface-hover flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-600 dark:text-neutral-300">
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-semibold">{title || 'Document'}</span>
          <span className="ml-auto shrink-0 tabular-nums">
            {slides.length} pages
          </span>
        </div>
      )}
      <div
        className="group relative"
        role="region"
        aria-roledescription="carousel"
        aria-label={`${slides.length} slides`}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <div
          ref={track}
          onScroll={onScroll}
          className="flex aspect-4/5 max-h-[min(34rem,60vh)] w-full snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
        >
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => onOpen?.(i)}
              disabled={!onOpen}
              aria-label={`Slide ${i + 1} of ${slides.length}`}
              className={`h-full w-full shrink-0 snap-center ${onOpen ? 'cursor-zoom-in' : 'cursor-default'}`}
            >
              <SlideImage slide={slide} eager={i < 2} />
            </button>
          ))}
        </div>

        {/* The counter, where the platform puts it. */}
        <span
          className={`pointer-events-none absolute rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums ${isDocument ? 'bottom-3 left-1/2 -translate-x-1/2' : 'top-3 right-3'}`}
        >
          {index + 1}/{slides.length}
        </span>

        {index > 0 && (
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Previous slide"
            className="absolute top-1/2 left-2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow-md transition-opacity hover:bg-white sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {index < slides.length - 1 && (
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next slide"
            className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow-md transition-opacity hover:bg-white sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Instagram's dots under the slides. */}
      {!isDocument && (
        <div className="flex justify-center gap-1 pt-3" aria-hidden>
          {slides.map((slide, i) => (
            <span
              key={slide.id}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${i === index ? 'bg-[#0095f6]' : 'bg-neutral-300 dark:bg-neutral-600'}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Facebook's feed: the first slides as a grid, the rest behind "+N". */
function FacebookGrid({ slides, onOpen, onIndexChange }: CarouselViewerProps) {
  const shown = slides.slice(0, 4)
  const more = slides.length - shown.length
  const open = (i: number) => {
    onIndexChange?.(i)
    onOpen?.(i)
  }
  return (
    <div
      className={`grid w-full gap-0.5 ${shown.length === 2 ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2'} aspect-square max-h-[min(34rem,60vh)]`}
    >
      {shown.map((slide, i) => (
        <button
          key={slide.id}
          type="button"
          onClick={() => open(i)}
          aria-label={`Photo ${i + 1} of ${slides.length}`}
          className={`relative min-h-0 cursor-zoom-in overflow-hidden ${shown.length === 3 && i === 0 ? 'row-span-2' : ''}`}
        >
          <SlideImage slide={slide} eager />
          {i === shown.length - 1 && more > 0 && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white">
              +{more}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
