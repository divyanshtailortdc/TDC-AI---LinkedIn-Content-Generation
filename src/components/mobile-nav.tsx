'use client'

import { Menu } from 'lucide-react'
import { usePathname } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from 'react'

type MobileNav = {
  open: boolean
  setOpen: (open: boolean) => void
}

const MobileNavContext = createContext<MobileNav | null>(null)

/**
 * Open state of the sidebar drawer used below the `lg` breakpoint. It is
 * remembered together with the page it was opened on, so moving to another
 * page closes it without an effect.
 */
export function MobileNavProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  const setOpen = useCallback(
    (next: boolean) => setOpenedOn(next ? pathname : null),
    [pathname]
  )
  const value = useMemo(
    () => ({ open: openedOn === pathname, setOpen }),
    [openedOn, pathname, setOpen]
  )
  return (
    <MobileNavContext.Provider value={value}>
      {children}
    </MobileNavContext.Provider>
  )
}

export function useMobileNav(): MobileNav {
  return useContext(MobileNavContext) ?? { open: false, setOpen: () => {} }
}

/** The hamburger that opens the sidebar drawer. Hidden once the sidebar is always visible. */
export function MobileNavButton() {
  const { setOpen } = useMobileNav()
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open navigation"
      className="border-border text-foreground hover:bg-surface-hover -ml-1 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border transition-colors sm:h-11 sm:w-11 lg:hidden"
    >
      <Menu className="h-5 w-5" />
    </button>
  )
}
