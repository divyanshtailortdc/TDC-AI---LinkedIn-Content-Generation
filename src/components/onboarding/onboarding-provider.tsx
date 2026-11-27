'use client'

import { updateOnboarding } from '@/lib/onboarding/actions'
import type { OnboardingChange } from '@/lib/onboarding/state'
import type { OnboardingView } from '@/lib/onboarding/view'
import {
  bufferCallbackMessage,
  isCallbackResult
} from '@/lib/publishing/callback-results'
import { PLATFORM_PARAM, RESULT_PARAM } from '@/lib/publishing/return-path'
import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import { usePathname } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'

/**
 * The onboarding progress of the active identity, shared by the dashboard
 * checklist and a post's publish controls. The layout renders it first;
 * after that it is re-read from /api/onboarding:
 *
 * - after each navigation (a layout does not re-render on navigation),
 * - when the tab comes back into view (work done in another tab, or Buffer),
 * - every few seconds on the dashboard while the app is busy (a run, a
 *   draft, a publish), so the checklist ticks it off without a reload,
 * - when a component says something changed (refreshOnboarding).
 */

/** How connecting Buffer ended, when this page was just returned to from it. */
export type BufferOutcome = { ok: boolean; message: string }

type OnboardingContextValue = {
  view: OnboardingView
  bufferOutcome: BufferOutcome | null
  /** Re-reads the progress now. */
  refresh: () => Promise<void>
  /** Skips, confirms or hides; resolves to the error, or null when saved. */
  change: (change: OnboardingChange) => Promise<string | null>
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null)

const REFRESH_EVENT = 'onboarding:refresh'

/** Tells the onboarding progress that saved data changed (a post published, say). */
export function refreshOnboarding() {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(REFRESH_EVENT))
}

/** While a run, a draft or a publish is under way. */
const BUSY_POLL_MS = 5_000

export function OnboardingProvider({
  initial,
  children
}: {
  initial: OnboardingView
  children: ReactNode
}) {
  const [view, setView] = useState(initial)
  // A new render of the layout (router.refresh, an action that revalidates)
  // brings fresher progress: take it.
  const [lastInitial, setLastInitial] = useState(initial)
  if (initial !== lastInitial) {
    setLastInitial(initial)
    setView(initial)
  }
  const pathname = usePathname()
  // Answers can arrive out of order; only the newest request's counts.
  const latestRequest = useRef(0)

  // The first post is out and the guide put away: nothing left to follow
  // (a new layout render still brings any change).
  const finished = useRef(false)
  useEffect(() => {
    finished.current = view.progress.complete && view.hidden
  })

  const refresh = useCallback(async () => {
    if (finished.current) return
    const request = ++latestRequest.current
    try {
      const res = await fetch('/api/onboarding', { cache: 'no-store' })
      if (!res.ok || request !== latestRequest.current) return
      setView((await res.json()) as OnboardingView)
    } catch {
      // Offline or the server restarting: the next refresh catches up.
    }
  }, [])

  const change = useCallback(async (next: OnboardingChange) => {
    const result = await updateOnboarding(next).catch(() => null)
    if (!result) return 'Could not save that. Please try again.'
    if (!result.ok) return result.error
    latestRequest.current++
    setView(result.view)
    return null
  }, [])

  // The outcome of connecting Buffer, when the page was just returned to from
  // Buffer's screen (src/lib/publishing/return-path.ts). Read here, once, for
  // the checklist; the address is then cleaned, so a reload does not show it
  // again. Settings → Integrations
  // shows it on its own Buffer card.
  const [outcome, setOutcome] = useState<
    (BufferOutcome & { path: string }) | null
  >(null)
  useEffect(() => {
    if (pathname === INTEGRATIONS_SETTINGS_PATH) return
    const url = new URL(window.location.href)
    const result = url.searchParams.get(RESULT_PARAM)
    if (
      url.searchParams.get(PLATFORM_PARAM) !== 'buffer' ||
      !isCallbackResult(result)
    ) {
      return
    }
    // A one-off read of the address the browser came back to.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOutcome({
      ok: result === 'connected',
      message: bufferCallbackMessage(result),
      path: pathname
    })
    url.searchParams.delete(RESULT_PARAM)
    url.searchParams.delete(PLATFORM_PARAM)
    window.history.replaceState(window.history.state, '', url)
  }, [pathname])
  // Shown on the page it came back to only.
  const bufferOutcome = outcome?.path === pathname ? outcome : null

  // After a navigation; not on the first render, which the layout just made.
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (pathname === lastPath.current) return
    lastPath.current = pathname
    void refresh()
  }, [pathname, refresh])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const onEvent = () => void refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener(REFRESH_EVENT, onEvent)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener(REFRESH_EVENT, onEvent)
    }
  }, [refresh])

  const { progress } = view
  const busy = progress.steps.some(s => s.status === 'working')
  // Only the dashboard checklist shows progress live; nothing to follow
  // once complete.
  const interval =
    !progress.complete && busy && pathname === '/' ? BUSY_POLL_MS : null
  useEffect(() => {
    if (!interval) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, interval)
    return () => clearInterval(timer)
  }, [interval, refresh])

  return (
    <OnboardingContext.Provider
      value={{ view, bufferOutcome, refresh, change }}
    >
      {children}
    </OnboardingContext.Provider>
  )
}

/** The onboarding progress; null outside the signed-in app. */
export function useOnboarding() {
  return useContext(OnboardingContext)
}
