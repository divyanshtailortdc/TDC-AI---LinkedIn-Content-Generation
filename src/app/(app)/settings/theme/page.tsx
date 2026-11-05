import { requireUser } from '@/lib/session'
import { parseThemePrefs, THEME_PREFS_COOKIE } from '@/lib/theme-prefs'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { ThemePrefsForm } from './theme-prefs-form'

export const metadata: Metadata = {
  title: 'Theme · TDC LinkedIn Content Engine'
}

export default async function ThemeSettingsPage() {
  await requireUser()
  const cookieStore = await cookies()
  return (
    <ThemePrefsForm
      initialPrefs={parseThemePrefs(cookieStore.get(THEME_PREFS_COOKIE)?.value)}
    />
  )
}
