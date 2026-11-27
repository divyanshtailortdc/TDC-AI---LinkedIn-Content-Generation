'use client'

import { cn } from '@/lib/cn'
import { ChevronDown } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject
} from 'react'
import { useTooltip } from './tooltip'

/**
 * The look every text field, text box and select in the app shares: one
 * border, background, corner, focus ring and disabled state, on the light and
 * dark theme. Pass extra classes after it (through cn) to change the size.
 */
export const FIELD_CLASS =
  'border-border bg-background text-foreground placeholder:text-muted/70 w-full min-w-0 rounded-lg border px-3 py-2 text-sm leading-6 shadow-xs transition-[border-color,box-shadow] outline-none hover:border-muted/60 focus:border-brand focus:ring-3 focus:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-rose-500'

/** A field's label, above it. */
export const LABEL_CLASS = 'text-foreground mb-1.5 block text-sm font-medium'

/**
 * A one-line value (a title, a keyword, an address) in a field that wraps
 * onto more lines and grows as the text gets longer, so the whole of it is
 * always in view while typing, instead of scrolling sideways out of sight.
 *
 * It behaves as a one-line field: Enter never adds a line break (it submits
 * the form, as it would in an input), and pasted line breaks become spaces.
 * It is a textarea underneath, so `type` does not apply: use inputMode
 * ("url", "email") for the right phone keyboard.
 */
export function TextField({
  className,
  maxRows = 6,
  onChange,
  onKeyDown,
  style,
  ref,
  ...props
}: Omit<ComponentProps<'textarea'>, 'rows'> & {
  /** The most lines shown before the field scrolls. */
  maxRows?: number
}) {
  const inner = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement, [])
  useAutoGrow(inner, props.value)
  return (
    <textarea
      ref={inner}
      rows={1}
      {...props}
      onChange={event => {
        const field = event.currentTarget
        if (/[\r\n]/.test(field.value)) {
          field.value = field.value.replace(/\s*[\r\n]+\s*/g, ' ')
        }
        onChange?.(event)
      }}
      onKeyDown={event => {
        onKeyDown?.(event)
        if (
          event.defaultPrevented ||
          event.key !== 'Enter' ||
          event.nativeEvent.isComposing
        ) {
          return
        }
        event.preventDefault()
        submitLikeAnInput(event.currentTarget)
      }}
      style={{ maxHeight: `calc(${maxRows}lh + 1rem + 2px)`, ...style }}
      className={cn(
        FIELD_CLASS,
        'block resize-none overflow-y-auto [overflow-wrap:anywhere] [field-sizing:content]',
        className
      )}
    />
  )
}

/**
 * A text box for a few lines or more. It grows with its text from `rows`
 * lines up to `maxRows`, then scrolls, so nothing typed hides behind a small
 * fixed box. `autoGrow={false}` keeps a fixed height the reader can drag.
 */
export function TextArea({
  className,
  rows = 3,
  maxRows = 16,
  autoGrow = true,
  style,
  ref,
  ...props
}: ComponentProps<'textarea'> & {
  /** The most lines shown before the box scrolls (when it grows). */
  maxRows?: number
  autoGrow?: boolean
}) {
  const inner = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement, [])
  useAutoGrow(inner, props.value, autoGrow)
  return (
    <textarea
      ref={inner}
      rows={rows}
      {...props}
      style={
        autoGrow
          ? {
              minHeight: `calc(${rows}lh + 1rem + 2px)`,
              maxHeight: `calc(${maxRows}lh + 1rem + 2px)`,
              ...style
            }
          : style
      }
      className={cn(
        FIELD_CLASS,
        'block [overflow-wrap:anywhere]',
        autoGrow
          ? 'resize-none overflow-y-auto [field-sizing:content]'
          : 'resize-y',
        className
      )}
    />
  )
}

/**
 * A native select in the shared look, with its own chevron. The list itself
 * is the browser's, so no scroll box or dialog can clip it, and phones show
 * their own picker.
 *
 * When the chosen option is cut off (a long audience or goal name), its
 * whole text shows in a tooltip on hover or keyboard focus, and is read out
 * to screen readers. An option shortened for the list can carry its whole
 * text in its `title`: that is what the tooltip shows.
 *
 * Classes go on the select; `wrapperClassName` sizes the box around it.
 */
export function Select({
  className,
  wrapperClassName,
  children,
  onChange,
  ref,
  ...props
}: ComponentProps<'select'> & { wrapperClassName?: string }) {
  const inner = useRef<HTMLSelectElement>(null)
  useImperativeHandle(ref, () => inner.current as HTMLSelectElement, [])
  const [whole, setWhole] = useState<string | null>(null)
  const descriptionId = useId()

  const measure = useCallback(() => {
    const select = inner.current
    const option = select?.selectedOptions[0]
    if (!select || !option) {
      setWhole(null)
      return
    }
    const shown = option.text
    const full = option.title.trim() || shown
    const cut = full !== shown || isCut(select, shown)
    setWhole(cut ? full : null)
  }, [])

  useLayoutEffect(measure, [measure, props.value, children])
  useEffect(() => {
    const select = inner.current
    if (!select) return
    const observer = new ResizeObserver(measure)
    observer.observe(select)
    return () => observer.disconnect()
  }, [measure])

  const tip = useTooltip(whole)
  const describedBy =
    [props['aria-describedby'], whole ? descriptionId : null]
      .filter(Boolean)
      .join(' ') || undefined

  return (
    <div className={cn('relative min-w-0', wrapperClassName)}>
      <select
        ref={inner}
        {...props}
        aria-describedby={describedBy}
        onPointerEnter={event => {
          tip.triggerProps.onPointerEnter(event)
          props.onPointerEnter?.(event)
        }}
        onPointerLeave={event => {
          tip.triggerProps.onPointerLeave()
          props.onPointerLeave?.(event)
        }}
        onPointerDown={event => {
          tip.triggerProps.onPointerDown()
          props.onPointerDown?.(event)
        }}
        onFocus={event => {
          tip.triggerProps.onFocus(event)
          props.onFocus?.(event)
        }}
        onBlur={event => {
          tip.triggerProps.onBlur()
          props.onBlur?.(event)
        }}
        onChange={event => {
          tip.hide()
          onChange?.(event)
          measure()
        }}
        onKeyDown={event => {
          tip.hide()
          props.onKeyDown?.(event)
        }}
        className={cn(
          FIELD_CLASS,
          'peer block cursor-pointer appearance-none truncate pr-9',
          className
        )}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="text-muted pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 peer-disabled:hidden"
      />
      {whole && (
        <span id={descriptionId} className="sr-only">
          {whole}
        </span>
      )}
      {tip.tooltip}
    </div>
  )
}

let measuringCanvas: HTMLCanvasElement | null = null

/** Whether `text` is wider than the room inside the select. */
function isCut(select: HTMLSelectElement, text: string) {
  measuringCanvas ??= document.createElement('canvas')
  const context = measuringCanvas.getContext('2d')
  if (!context) return false
  const css = getComputedStyle(select)
  context.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`
  const room =
    select.clientWidth -
    parseFloat(css.paddingLeft) -
    parseFloat(css.paddingRight)
  return context.measureText(text).width > room + 0.5
}

/**
 * What Enter does in a one-line input: submit the form through its default
 * button (nothing when that button is disabled), or, with no button, only
 * when this is the form's one field.
 */
function submitLikeAnInput(field: HTMLTextAreaElement) {
  const form = field.form
  if (!form) return
  const button = form.querySelector<HTMLButtonElement | HTMLInputElement>(
    'button[type="submit"], button:not([type]), input[type="submit"]'
  )
  if (button) {
    if (!button.disabled) form.requestSubmit(button)
    return
  }
  const fields = form.querySelectorAll(
    'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="tel"], input[type="password"], input[type="number"]'
  )
  if (fields.length === 1) form.requestSubmit()
}

const supportsFieldSizing = () =>
  typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content')

/**
 * Grows a textarea to fit its text in browsers without CSS field-sizing
 * (where field-sizing: content already does it). It refits when the value
 * changes, on typing (for an uncontrolled box) and when its width changes.
 */
function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: unknown,
  enabled = true
) {
  const fit = useCallback(() => {
    const box = ref.current
    if (!box || !enabled || supportsFieldSizing()) return
    box.style.height = 'auto'
    const borders = box.offsetHeight - box.clientHeight
    box.style.height = `${box.scrollHeight + borders}px`
  }, [ref, enabled])

  useLayoutEffect(fit, [fit, value])

  useEffect(() => {
    const box = ref.current
    if (!box || !enabled || supportsFieldSizing()) return
    let width = box.clientWidth
    const observer = new ResizeObserver(() => {
      if (box.clientWidth === width) return
      width = box.clientWidth
      fit()
    })
    observer.observe(box)
    box.addEventListener('input', fit)
    return () => {
      observer.disconnect()
      box.removeEventListener('input', fit)
    }
  }, [ref, enabled, fit])
}
