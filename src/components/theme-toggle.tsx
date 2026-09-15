'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  // Avoid hydration mismatch by waiting until mounted
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        className="relative inline-flex items-center justify-center rounded-xl p-2.5 text-muted hover:bg-surface-hover hover:text-foreground transition-colors border border-transparent hover:border-border cursor-pointer w-10 h-10"
      >
        <div className="w-5 h-5 opacity-0" />
      </button>
    )
  }

  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="relative inline-flex items-center justify-center rounded-xl p-2 text-muted hover:bg-surface-hover hover:text-foreground transition-all border border-transparent hover:border-border cursor-pointer w-9 h-9 sm:w-10 sm:h-10 shadow-xs"
      title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
    >
      <Sun
        className={`absolute w-4 h-4 sm:w-5 sm:h-5 transition-all duration-300 ease-in-out ${
          isDark ? 'scale-0 -rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100'
        }`}
      />
      <Moon
        className={`absolute w-4 h-4 sm:w-5 sm:h-5 transition-all duration-300 ease-in-out ${
          isDark ? 'scale-100 rotate-0 opacity-100' : 'scale-0 rotate-90 opacity-0'
        }`}
      />
      <span className="sr-only">Toggle theme</span>
    </button>
  )
}
