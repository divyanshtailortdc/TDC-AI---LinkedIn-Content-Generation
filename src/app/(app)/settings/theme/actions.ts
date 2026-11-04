'use server'

import { requireUser } from '@/lib/session'
import {
  isDefaultThemePrefs,
  normalizeHex,
  THEME_PREFS_COOKIE,
  type ThemeMode,
  type ThemePrefs
} from '@/lib/theme-prefs'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

type ActionResult = { success: true } | { success: false; error: string }

/**
 * Saves the user's colours in this browser. Colours equal to the defaults
 * clear the cookie, so a reset leaves nothing behind.
 */
export async function saveThemePrefsAction(
  raw: ThemePrefs
): Promise<ActionResult> {
  await requireUser()
  const read = (mode: ThemeMode) => ({
    primary: normalizeHex(raw?.[mode]?.primary),
    secondary: normalizeHex(raw?.[mode]?.secondary)
  })
  const light = read('light')
  const dark = read('dark')
  if (!light.primary || !light.secondary || !dark.primary || !dark.secondary) {
    return { success: false, error: 'Every colour must be a #rrggbb value.' }
  }
  const prefs: ThemePrefs = {
    light: { primary: light.primary, secondary: light.secondary },
    dark: { primary: dark.primary, secondary: dark.secondary }
  }

  const cookieStore = await cookies()
  if (isDefaultThemePrefs(prefs)) {
    cookieStore.delete(THEME_PREFS_COOKIE)
  } else {
    cookieStore.set(THEME_PREFS_COOKIE, JSON.stringify(prefs), {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production'
    })
  }
  // Every page reads the colours in the app layout.
  revalidatePath('/', 'layout')
  return { success: true }
}
