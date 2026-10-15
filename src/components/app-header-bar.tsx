import { ThemeToggle } from '@/components/theme-toggle'
import type { ReactNode } from 'react'

/**
 * The top bar every page shares: setup steps and routes like Dashboard, Ideas
 * or Settings. It runs edge to edge (no gap above, left or right) and has one
 * fixed height: more data never makes it taller, so content shrinks or is cut
 * with an ellipsis instead. When the bar is too narrow for everything on one
 * row it wraps in a fixed way (that depends on width, never on data).
 *
 * Sized by its own width, not the screen's: the app sidebar takes part of the
 * screen, so a "wide" screen can still be a narrow header. That is why it is a
 * container, and children can use `@4xl:` and friends.
 */
export function AppHeaderBar({
  children,
  actions,
  wide = false
}: {
  children: ReactNode
  /**
   * The page's own buttons. They sit to the left of the theme button, which
   * the bar always draws itself as the last item at the right end, so it is in
   * the same place on every route.
   */
  actions?: ReactNode
  /**
   * The bar holds the setup steps, which need about 56rem to sit in one row
   * with the buttons. Without it, one row is enough from 42rem.
   */
  wide?: boolean
}) {
  return (
    <header className="border-border bg-surface @container w-full border-b px-4 py-3 shadow-xs sm:px-6 sm:py-5">
      <div
        className={`flex w-full flex-wrap items-center gap-x-6 gap-y-3 sm:min-h-[4.2rem] ${
          wide
            ? '@min-[56rem]:h-[4.2rem] @min-[56rem]:flex-nowrap'
            : '@2xl:h-[4.2rem] @2xl:flex-nowrap'
        }`}
      >
        {children}
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          {actions}
          <HeaderThemeToggle />
        </div>
      </div>
    </header>
  )
}

/** The theme switch, sized to sit beside the bar's buttons. */
function HeaderThemeToggle() {
  return (
    <div className="border-border rounded-xl border sm:[&_button]:h-11 sm:[&_button]:w-11">
      <ThemeToggle />
    </div>
  )
}
