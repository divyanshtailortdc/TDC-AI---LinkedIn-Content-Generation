'use client'

import { RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const MIN_SCALE = 1
const MAX_SCALE = 8
/** Multiplier for the zoom buttons and +/- keys. */
const ZOOM_STEP = 1.5
const DOUBLE_CLICK_SCALE = 2.5
/** Pointer travel (px) after which a press counts as a drag, not a click. */
const DRAG_THRESHOLD = 3

type Point = { x: number; y: number }
type View = { scale: number; x: number; y: number }

const RESET_VIEW: View = { scale: 1, x: 0, y: 0 }

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

interface ImageLightboxProps {
  src: string
  alt: string
  onClose: () => void
  /** Intrinsic size hints for next/image; the image is always fitted to the screen. */
  width?: number
  height?: number
}

/**
 * Full-screen image viewer with zoom and pan.
 *
 * Mount it only while open — every mount starts at 100%, so there is no reset
 * logic to keep in sync. Rendered into document.body so scroll containers and
 * transformed ancestors cannot clip it.
 */
export function ImageLightbox({
  src,
  alt,
  onClose,
  width = 2048,
  height = 1072
}: ImageLightboxProps) {
  const [view, setView] = useState<View>(RESET_VIEW)
  const [isDragging, setIsDragging] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef({ startDistance: 0, startScale: 1 })
  const movedDuringPress = useRef(false)
  /** Whether the current press began on the dark backdrop rather than the image. */
  const pressStartedOnBackdrop = useRef(false)

  /** Keeps the scale in range and stops the image being dragged off-screen. */
  const clamp = useCallback((next: View): View => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next.scale))
    const stage = stageRef.current
    const image = imageRef.current
    if (!stage || !image) return { ...next, scale }

    // offsetWidth/Height are the fitted, untransformed size of the image.
    const maxX = Math.max(0, (image.offsetWidth * scale - stage.clientWidth) / 2)
    const maxY = Math.max(0, (image.offsetHeight * scale - stage.clientHeight) / 2)
    return {
      scale,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y))
    }
  }, [])

  /**
   * Zooms so the point under (clientX, clientY) stays put — or around the centre
   * when no point is given. The stage centre is the transform origin, so a screen
   * point p shows image point (p - offset) / scale.
   */
  const zoomTo = useCallback(
    (getScale: (current: number) => number, clientX?: number, clientY?: number) => {
      setView((prev) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, getScale(prev.scale)))
        const stage = stageRef.current
        let px = 0
        let py = 0
        if (stage && clientX !== undefined && clientY !== undefined) {
          const rect = stage.getBoundingClientRect()
          px = clientX - rect.left - rect.width / 2
          py = clientY - rect.top - rect.height / 2
        }
        const ratio = scale / prev.scale
        return clamp({ scale, x: px - (px - prev.x) * ratio, y: py - (py - prev.y) * ratio })
      })
    },
    [clamp]
  )

  const reset = () => setView(RESET_VIEW)

  // Wheel must be a non-passive native listener, or preventDefault is ignored and
  // the page scrolls behind the viewer.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const deltaY = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY // Firefox reports lines
      // Trackpad pinch arrives as ctrl+wheel with small deltas, so it gets more gain.
      const factor = Math.exp(-deltaY * (e.ctrlKey ? 0.01 : 0.002))
      zoomTo((s) => s * factor, e.clientX, e.clientY)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [zoomTo])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === '+' || e.key === '=') zoomTo((s) => s * ZOOM_STEP)
      else if (e.key === '-' || e.key === '_') zoomTo((s) => s / ZOOM_STEP)
      else if (e.key === '0') setView(RESET_VIEW)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, zoomTo])

  // Lock page scroll and move focus into the dialog; restore both on close.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previouslyFocused = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // Read the target before capturing: once captured, the browser reports the
    // follow-up click as landing on the stage even when the image was clicked.
    pressStartedOnBackdrop.current = e.target === e.currentTarget
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    movedDuringPress.current = false

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point]
      pinch.current = { startDistance: distance(a, b), startScale: view.scale }
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(e.pointerId)
    if (!previous) return
    const point = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, point)

    if (distance(previous, point) > 0) {
      if (Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y) > DRAG_THRESHOLD) {
        movedDuringPress.current = true
      }
    }

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point]
      const center = midpoint(a, b)
      const target = (pinch.current.startScale * distance(a, b)) / (pinch.current.startDistance || 1)
      setIsDragging(true)
      zoomTo(() => target, center.x, center.y)
    } else if (view.scale > 1) {
      setIsDragging(true)
      setView((prev) =>
        clamp({ ...prev, x: prev.x + point.x - previous.x, y: prev.y + point.y - previous.y })
      )
    }
  }

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) setIsDragging(false)
  }

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Clicking the dark area around the image closes; clicking the image or
    // finishing a drag does not.
    if (pressStartedOnBackdrop.current && !movedDuringPress.current) onClose()
  }

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (view.scale > 1) reset()
    else zoomTo(() => DOUBLE_CLICK_SCALE, e.clientX, e.clientY)
  }

  const cursor = view.scale > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Zoomed image: ${alt}`}
      className="fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <p className="min-w-0 truncate text-xs text-white/70">{alt}</p>
        <div className="flex shrink-0 items-center gap-1">
          <ToolbarButton
            label="Zoom out"
            disabled={view.scale <= MIN_SCALE}
            onClick={() => zoomTo((s) => s / ZOOM_STEP)}
          >
            <ZoomOut className="h-4 w-4" />
          </ToolbarButton>
          <span className="w-12 text-center text-xs tabular-nums text-white/80">
            {Math.round(view.scale * 100)}%
          </span>
          <ToolbarButton
            label="Zoom in"
            disabled={view.scale >= MAX_SCALE}
            onClick={() => zoomTo((s) => s * ZOOM_STEP)}
          >
            <ZoomIn className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton label="Reset zoom" disabled={view.scale === 1} onClick={reset}>
            <RotateCcw className="h-4 w-4" />
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-white/20" />
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={`relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden ${cursor}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onClick={handleStageClick}
        onDoubleClick={handleDoubleClick}
      >
        <Image
          ref={imageRef}
          src={src}
          alt={alt}
          width={width}
          height={height}
          unoptimized
          draggable={false}
          className="h-auto max-h-[calc(100vh-7rem)] w-auto max-w-[calc(100vw-2rem)] object-contain will-change-transform"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: isDragging ? 'none' : 'transform 120ms ease-out'
          }}
        />
      </div>

      <p className="pb-3 text-center text-[11px] text-white/50">
        Scroll or pinch to zoom · drag to move · double-click to toggle · Esc to close
      </p>
    </div>,
    document.body
  )
}

function ToolbarButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
