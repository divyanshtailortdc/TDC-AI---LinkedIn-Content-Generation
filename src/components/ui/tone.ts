/**
 * The app's status colours, one set used by every page, so "needs review",
 * "scheduled" or "failed" look the same on Runs, Posts, Schedule and
 * Newsletters. Each tone works on the light and dark theme.
 *
 * What each tone means:
 * - neutral: nothing to do or not started (draft, stopped, not a newsletter)
 * - info: approved, decided, waiting on nothing from the reader
 * - brand: moving or queued (running, scheduled, publishing, processing)
 * - success: done and out (completed, published, subscribed)
 * - warning: needs the reader (to review, awaiting confirmation)
 * - danger: failed or rejected
 */
export type Tone = 'neutral' | 'info' | 'brand' | 'success' | 'warning' | 'danger'

export const TONES: Record<
  Tone,
  {
    /** A chip or pill: border, soft background and readable text. */
    chip: string
    /** A small solid dot. */
    dot: string
    /** Text or an icon in this tone. */
    text: string
    /** A soft tinted background, for an icon well or a banner. */
    soft: string
    /** A solid bar fill (meters, stacked bars). */
    bar: string
    /** A tinted border, for a card in this state. */
    border: string
    /** A focus or selection ring in this tone. */
    ring: string
  }
> = {
  neutral: {
    chip: 'border-border bg-surface-hover text-muted',
    dot: 'bg-zinc-400 dark:bg-zinc-500',
    text: 'text-muted',
    soft: 'bg-surface-hover',
    bar: 'bg-zinc-400 dark:bg-zinc-500',
    border: 'border-border',
    ring: 'ring-foreground/25'
  },
  info: {
    chip: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
    dot: 'bg-indigo-500',
    text: 'text-indigo-600 dark:text-indigo-300',
    soft: 'bg-indigo-500/10',
    bar: 'bg-indigo-500',
    border: 'border-indigo-500/30',
    ring: 'ring-indigo-500/50'
  },
  brand: {
    chip: 'border-brand/30 bg-brand/10 text-brand-strong',
    dot: 'bg-brand',
    text: 'text-brand-strong',
    soft: 'bg-brand/10',
    bar: 'bg-brand',
    border: 'border-brand/40',
    ring: 'ring-brand/50'
  },
  success: {
    chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    soft: 'bg-emerald-500/10',
    bar: 'bg-emerald-500',
    border: 'border-emerald-500/30',
    ring: 'ring-emerald-500/50'
  },
  warning: {
    chip: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-400',
    soft: 'bg-amber-500/10',
    bar: 'bg-amber-500',
    border: 'border-amber-500/40',
    ring: 'ring-amber-500/50'
  },
  danger: {
    chip: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
    dot: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
    soft: 'bg-rose-500/10',
    bar: 'bg-rose-500',
    border: 'border-rose-500/30',
    ring: 'ring-rose-500/50'
  }
}

/**
 * The keyboard focus ring every custom control uses, so focus looks the same
 * on every page. Add it to any button or link that is not a `Button`.
 */
export const FOCUS_RING =
  'focus-visible:ring-foreground/30 focus-visible:ring-2 focus-visible:outline-none'
