'use client'

import { Button } from '@/components/button'
import { FIELD_CLASS } from '@/components/ui/field'
import { useAnchoredPanel } from '@/components/ui/floating'
import { cn } from '@/lib/cn'
import { Pipette } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent
} from 'react'

/** Hue 0-360, saturation and value 0-1. */
type Hsv = { h: number; s: number; v: number }

/** Strong brand colours: blues, purples, warm and cool tones, and darks. */
export const BRAND_SWATCHES = [
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#c026d3',
  '#db2777',
  '#e11d48',
  '#dc2626',
  '#ea580c',
  '#d97706',
  '#65a30d',
  '#16a34a',
  '#059669',
  '#0d9488',
  '#0891b2',
  '#334155',
  '#0f172a'
] as const

/** Soft whites and tints, all light enough for an image background. */
export const LIGHT_SWATCHES = [
  '#ffffff',
  '#f8fafc',
  '#f1f5f9',
  '#e2e8f0',
  '#fafaf9',
  '#f5f5f4',
  '#fffbeb',
  '#fff7ed',
  '#fef2f2',
  '#fdf2f8',
  '#faf5ff',
  '#eef2ff',
  '#eff6ff',
  '#f0f9ff',
  '#ecfdf5',
  '#f0fdf4'
] as const

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** "#0e7c86" for "0E7C86", "#0e7" or "#0e7c86"; null for anything else. */
function parseHex(value: string): string | null {
  const raw = HEX.exec(value.trim())?.[1]?.toLowerCase()
  if (!raw) return null
  return `#${raw.length === 3 ? [...raw].map(c => c + c).join('') : raw}`
}

function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(5)}${channel(3)}${channel(1)}`
}

/** Greys have no hue of their own, so they keep the one already chosen. */
function hexToHsv(hex: string, keepHue = 0): Hsv {
  const [r, g, b] = [1, 3, 5].map(
    i => parseInt(hex.slice(i, i + 2), 16) / 255
  ) as [number, number, number]
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = keepHue
  if (d) {
    const sector =
      max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h = (sector * 60 + 360) % 360
  }
  return { h, s: max ? d / max : 0, v: max }
}

const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n))

/** Where a pointer is inside an element, 0-1 on each axis. */
function pointerRatio(event: PointerEvent<HTMLElement>) {
  const box = event.currentTarget.getBoundingClientRect()
  return {
    x: clamp((event.clientX - box.left) / box.width),
    y: clamp((event.clientY - box.top) / box.height)
  }
}

/** Pointer handlers that call `onMove` on press and while dragging. */
function dragHandlers(onMove: (x: number, y: number) => void) {
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.focus()
      const { x, y } = pointerRatio(event)
      onMove(x, y)
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      const { x, y } = pointerRatio(event)
      onMove(x, y)
    }
  }
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }

/**
 * A colour swatch that opens a picker under it: a saturation and brightness
 * square, a hue bar, a hex field and preset swatches. Nothing changes until
 * "Set colour"; Cancel, Escape or a click elsewhere closes it untouched.
 * `validate` returns why a colour cannot be used (and blocks Set), or null.
 */
export function ColorPicker({
  label,
  value,
  onSet,
  fallback = '#2563eb',
  swatches = BRAND_SWATCHES,
  validate
}: {
  label: string
  value: string | null
  onSet: (hex: string) => void
  /** Where the picker starts when no colour is set yet. */
  fallback?: string
  swatches?: readonly string[]
  validate?: (hex: string) => string | null
}) {
  const [open, setOpen] = useState(false)
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value ?? fallback))
  // What the hex field shows while it is being typed in; null shows the
  // picked colour.
  const [draft, setDraft] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const position = useAnchoredPanel(open, trigger, panel)

  const hex = hsvToHex(hsv)
  const error = validate?.(hex) ?? null
  const eyeDropper =
    open && typeof window !== 'undefined'
      ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
      : undefined

  const pick = (next: Hsv) => {
    setHsv(next)
    setDraft(null)
  }

  const show = () => {
    setHsv(hexToHsv(parseHex(value ?? '') ?? fallback))
    setDraft(null)
    setOpen(true)
  }

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  const commit = () => {
    if (error) return
    if (hex !== value) onSet(hex)
    close()
  }

  useEffect(() => {
    if (!open) return
    const onPointer = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onAreaKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.01
    const moves: Record<string, Partial<Hsv>> = {
      ArrowLeft: { s: clamp(hsv.s - step) },
      ArrowRight: { s: clamp(hsv.s + step) },
      ArrowUp: { v: clamp(hsv.v + step) },
      ArrowDown: { v: clamp(hsv.v - step) }
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    pick({ ...hsv, ...move })
  }

  const onHueKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1
    const next =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? hsv.h - step
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? hsv.h + step
          : null
    if (next === null) return
    event.preventDefault()
    pick({ ...hsv, h: clamp(next, 0, 359) })
  }

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Choose ${label.toLowerCase()}`}
        title={`Choose ${label.toLowerCase()}`}
        onClick={() => (open ? close(false) : show())}
        className={cn(
          'focus-visible:ring-brand/30 flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border p-0.5 transition-colors focus-visible:ring-2 focus-visible:outline-none',
          value
            ? 'border-border hover:border-muted/60'
            : 'border-muted/50 text-muted hover:text-foreground hover:border-muted border-dashed',
          open && 'ring-brand/30 ring-2'
        )}
      >
        {value ? (
          <span
            className="h-full w-full rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]"
            style={{ backgroundColor: value }}
          />
        ) : (
          <Pipette aria-hidden className="h-4 w-4" />
        )}
      </button>

      {open && (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label={`${label} picker`}
          style={position}
          className="border-border bg-surface z-50 w-64 space-y-3 rounded-xl border p-3 shadow-lg motion-safe:animate-[overlay-in_120ms_ease-out]"
        >
          <div
            role="slider"
            tabIndex={0}
            aria-label="Saturation and brightness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.s * 100)}
            aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
            onKeyDown={onAreaKey}
            {...dragHandlers((x, y) => pick({ ...hsv, s: x, v: 1 - y }))}
            className="focus-visible:ring-brand/40 relative h-36 w-full cursor-crosshair touch-none rounded-lg focus-visible:ring-2 focus-visible:outline-none"
            style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
          >
            <div className="absolute inset-0 rounded-lg bg-linear-to-r from-white to-transparent" />
            <div className="absolute inset-0 rounded-lg bg-linear-to-t from-black to-transparent" />
            <span
              aria-hidden
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3),0_1px_3px_rgb(0_0_0/0.3)]"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                backgroundColor: hex
              }}
            />
          </div>

          <div
            role="slider"
            tabIndex={0}
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={359}
            aria-valuenow={Math.round(hsv.h)}
            onKeyDown={onHueKey}
            {...dragHandlers(x => pick({ ...hsv, h: Math.min(359, x * 360) }))}
            className="focus-visible:ring-brand/40 relative h-3 w-full cursor-pointer touch-none rounded-full focus-visible:ring-2 focus-visible:outline-none"
            style={{
              background:
                'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3),0_1px_3px_rgb(0_0_0/0.3)]"
              style={{
                left: `${(hsv.h / 359) * 100}%`,
                backgroundColor: `hsl(${hsv.h} 100% 50%)`
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <div
              className="border-border flex h-9 w-12 shrink-0 overflow-hidden rounded-lg border"
              title={value ? 'Current colour / new colour' : 'New colour'}
            >
              {value && (
                <span className="flex-1" style={{ backgroundColor: value }} />
              )}
              <span className="flex-1" style={{ backgroundColor: hex }} />
            </div>
            <div className="relative min-w-0 flex-1">
              <span className="text-muted pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-xs">
                #
              </span>
              <input
                aria-label="Hex colour"
                value={draft ?? hex.slice(1).toUpperCase()}
                maxLength={7}
                spellCheck={false}
                aria-invalid={draft !== null && parseHex(draft) === null}
                onChange={event => {
                  setDraft(event.target.value)
                  const typed = parseHex(event.target.value)
                  if (typed) setHsv(hexToHsv(typed, hsv.h))
                }}
                onBlur={() => setDraft(null)}
                onKeyDown={event => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  commit()
                }}
                className={cn(FIELD_CLASS, 'py-1.5 pl-6 font-mono text-xs uppercase')}
              />
            </div>
            {eyeDropper && (
              <button
                type="button"
                aria-label="Pick a colour from the screen"
                title="Pick a colour from the screen"
                onClick={async () => {
                  try {
                    const { sRGBHex } = await new eyeDropper().open()
                    const picked = parseHex(sRGBHex)
                    if (picked) pick(hexToHsv(picked, hsv.h))
                  } catch {
                    // Closed without picking.
                  }
                }}
                className="border-border text-muted hover:text-foreground hover:bg-surface-hover flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-colors"
              >
                <Pipette aria-hidden className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-8 gap-1.5">
            {swatches.map(swatch => (
              <button
                key={swatch}
                type="button"
                aria-label={swatch.toUpperCase()}
                title={swatch.toUpperCase()}
                aria-pressed={swatch === hex}
                onClick={() => pick(hexToHsv(swatch, hsv.h))}
                className={cn(
                  'aspect-square w-full cursor-pointer rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)] transition-transform hover:scale-110',
                  swatch === hex && 'ring-brand ring-offset-surface ring-2 ring-offset-1'
                )}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>

          {error && (
            <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <div className="border-border flex justify-end gap-2 border-t pt-3">
            <Button variant="secondary" size="sm" onClick={() => close()}>
              Cancel
            </Button>
            <Button size="sm" onClick={commit} disabled={!!error}>
              Set colour
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
