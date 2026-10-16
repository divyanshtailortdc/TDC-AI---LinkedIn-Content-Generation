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
        className="border-border text-muted relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors"
      >
        <div className="h-4 w-4 opacity-0" />
      </button>
    )
  }

  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="border-border text-muted hover:bg-surface-hover hover:text-foreground relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors"
      title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
    >
      <Sun
        className={`absolute h-4 w-4 transition-all duration-300 ease-in-out ${
          isDark ? 'scale-0 -rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100'
        }`}
      />
      <Moon
        className={`absolute h-4 w-4 transition-all duration-300 ease-in-out ${
          isDark ? 'scale-100 rotate-0 opacity-100' : 'scale-0 rotate-90 opacity-0'
        }`}
      />
      <span className="sr-only">Toggle theme</span>
    </button>
  )
}
