'use client'

import { cn } from '@/lib/cn'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

const MARGIN = 8
const GAP = 6
const MAX_WIDTH = 360

/**
 * A small tooltip for an element: it shows `content` after a short hover, or
 * straight away when the element gets keyboard focus, and hides on leave,
 * blur, a press, Escape or scrolling. Touch presses never open it (there is
 * no hover on a phone). The bubble is portalled to the body, so a scroll box
 * or a dialog cannot clip it. Nothing shows while `content` is empty.
 *
 * Spread `triggerProps` on the element and render `tooltip` anywhere.
 */
export function useTooltip(
  content: ReactNode,
  { delay = 400 }: { delay?: number } = {}
) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const id = useId()

  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setAnchor(null)
  }, [])

  const showFor = useCallback((element: Element, wait: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(
      () => setAnchor(element.getBoundingClientRect()),
      wait
    )
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    if (!anchor) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, hide])

  const hasContent = content !== null && content !== undefined && content !== ''
  const open = Boolean(anchor && hasContent)

  return {
    open,
    hide,
    triggerProps: {
      onPointerEnter: (event: PointerEvent<Element>) => {
        if (event.pointerType !== 'touch') showFor(event.currentTarget, delay)
      },
      onPointerLeave: hide,
      onPointerDown: hide,
      onFocus: (event: FocusEvent<Element>) => {
        if (event.currentTarget.matches(':focus-visible')) {
          showFor(event.currentTarget, 0)
        }
      },
      onBlur: hide
    },
    tooltip:
      open && anchor
        ? createPortal(
            <TooltipBubble id={id} anchor={anchor}>
              {content}
            </TooltipBubble>,
            document.body
          )
        : null
  }
}

/**
 * The bubble: over the element (under it near the top of the screen), lined
 * up with its left edge, or its right edge when it sits on the right half,
 * and kept inside the screen.
 */
function TooltipBubble({
  id,
  anchor,
  children
}: {
  id: string
  anchor: DOMRect
  children: ReactNode
}) {
  const viewportWidth = document.documentElement.clientWidth
  const maxWidth = Math.min(MAX_WIDTH, viewportWidth - MARGIN * 2)
  const above = anchor.top > 72
  const onRight = anchor.left + anchor.width / 2 > viewportWidth / 2
  const style: CSSProperties = {
    maxWidth,
    ...(onRight
      ? { right: Math.max(MARGIN, viewportWidth - anchor.right) }
      : { left: Math.max(MARGIN, anchor.left) }),
    ...(above
      ? { bottom: window.innerHeight - anchor.top + GAP }
      : { top: anchor.bottom + GAP })
  }
  return (
    <div
      id={id}
      role="tooltip"
      style={style}
      className="bg-foreground text-background pointer-events-none fixed z-[200] w-max rounded-lg px-2.5 py-1.5 text-xs leading-relaxed font-medium whitespace-pre-line shadow-lg [overflow-wrap:anywhere] motion-safe:animate-[overlay-in_120ms_ease-out]"
    >
      {children}
    </div>
  )
}

/**
 * Text cut to one line (or `lines` lines) with an ellipsis, that shows the
 * whole of it in a tooltip on hover, only when it is actually cut.
 */
export function TruncatedText({
  text,
  lines = 1,
  className
}: {
  text: string
  lines?: 1 | 2 | 3
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () =>
      setCut(
        lines === 1
          ? element.scrollWidth > element.clientWidth + 1
          : element.scrollHeight > element.clientHeight + 1
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text, lines])

  const tip = useTooltip(cut ? text : null)
  return (
    <span
      ref={ref}
      {...tip.triggerProps}
      className={cn(
        'block min-w-0',
        lines === 1 && 'truncate',
        lines === 2 && 'line-clamp-2',
        lines === 3 && 'line-clamp-3',
        className
      )}
    >
      {text}
      {tip.tooltip}
    </span>
  )
}
