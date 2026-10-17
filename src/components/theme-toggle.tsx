'use client'

import * as React from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

type ThemeChoice = 'light' | 'dark' | 'system'

// Each click moves to the next choice, so "follow my device" is always one or
// two clicks away instead of lost after the first toggle.
const NEXT_CHOICE: Record<ThemeChoice, ThemeChoice> = {
  light: 'dark',
  dark: 'system',
  system: 'light'
}

const CHOICE_LABEL: Record<ThemeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System'
}

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
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

  const choice: ThemeChoice =
    theme === 'light' || theme === 'dark' ? theme : 'system'
  const next = NEXT_CHOICE[choice]
  const current =
    choice === 'system'
      ? `System (${resolvedTheme === 'dark' ? 'dark' : 'light'})`
      : CHOICE_LABEL[choice]
  const icon = (shown: ThemeChoice) =>
    `absolute h-4 w-4 transition-all duration-300 ease-in-out ${
      choice === shown
        ? 'scale-100 rotate-0 opacity-100'
        : 'scale-0 rotate-90 opacity-0'
    }`

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="border-border text-muted hover:bg-surface-hover hover:text-foreground relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors"
      title={`Theme: ${current}. Click for ${CHOICE_LABEL[next]}.`}
    >
      <Sun className={icon('light')} />
      <Moon className={icon('dark')} />
      <Monitor className={icon('system')} />
      <span className="sr-only">{`Theme: ${current}. Switch to ${CHOICE_LABEL[next]}`}</span>
    </button>
  )
}
