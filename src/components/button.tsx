import { cn } from '@/lib/cn'
import { Loader2 } from 'lucide-react'
import type { ComponentProps } from 'react'

const VARIANTS = {
  primary: 'bg-accent text-background hover:bg-accent-hover',
  secondary:
    'border border-border bg-surface text-foreground hover:bg-surface-hover',
  linkedin: 'bg-linkedin text-white shadow-sm hover:bg-linkedin-hover'
} as const

const SIZES = {
  sm: 'h-8 gap-1.5 px-3.5 text-[13px]',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2.5 px-5 text-[15px]'
} as const

/** The button styles, for a link that should look like a button. */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
  className
}: {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
  className?: string
} = {}) {
  return cn(
    'inline-flex cursor-pointer items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
    VARIANTS[variant],
    SIZES[size],
    className
  )
}

export type ButtonProps = ComponentProps<'button'> & {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
  /** Shows a spinner and disables the button while work is in progress. */
  loading?: boolean
}

/** The app's button, in the same styles the pages already use inline. */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClassName({ variant, size, className })}
      {...props}
    >
      {loading && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}
