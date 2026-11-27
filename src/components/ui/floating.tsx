'use client'

import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject
} from 'react'

const MARGIN = 8
const MIN_HEIGHT = 120

const HIDDEN: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  visibility: 'hidden'
}

/**
 * Where an open dropdown panel goes, as an inline style: position: fixed
 * next to its button, so a scroll box or a card with overflow hidden cannot
 * clip it. Under the button, or over it when there is more room above;
 * lined up with the button's left edge (`end`: its right edge) and kept
 * inside the screen; no taller than the room there (it scrolls past that).
 * It follows the button while the page scrolls or resizes.
 *
 * The panel stays where it is in the page (no portal), so focus order and
 * "click outside" checks keep working. When an ancestor's transform or
 * filter makes it the reference for position: fixed, the offset is measured
 * and taken off.
 */
export function useAnchoredPanel(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  { align = 'start', gap = 6 }: { align?: 'start' | 'end'; gap?: number } = {}
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>(HIDDEN)

  useLayoutEffect(() => {
    if (!open) return
    let frame = 0
    const place = () => {
      const button = anchor.current
      const box = panel.current
      if (!button || !box) return
      const at = button.getBoundingClientRect()
      const now = box.getBoundingClientRect()
      // The containing block's corner: (0, 0) unless an ancestor moved it.
      const originX = now.left - (parseFloat(box.style.left) || 0)
      const originY = now.top - (parseFloat(box.style.top) || 0)

      const viewportWidth = document.documentElement.clientWidth
      const viewportHeight = window.innerHeight
      const width = box.offsetWidth
      const natural = box.scrollHeight + (box.offsetHeight - box.clientHeight)
      const below = viewportHeight - at.bottom - gap - MARGIN
      const above = at.top - gap - MARGIN
      const up = natural > below && above > below
      const maxHeight = Math.max(MIN_HEIGHT, up ? above : below)
      const height = Math.min(natural, maxHeight)
      const top = up ? at.top - gap - height : at.bottom + gap
      const left = Math.max(
        MARGIN,
        Math.min(
          align === 'end' ? at.right - width : at.left,
          viewportWidth - MARGIN - width
        )
      )
      setStyle({
        position: 'fixed',
        top: top - originY,
        left: left - originX,
        maxHeight,
        overflowY: 'auto'
      })
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    place()
    const observer = new ResizeObserver(schedule)
    if (panel.current) observer.observe(panel.current)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [open, anchor, panel, align, gap])

  // A reopened panel starts from where it last was; the layout effect moves
  // it before the browser paints, measuring from whatever style it has.
  return open ? style : HIDDEN
}
