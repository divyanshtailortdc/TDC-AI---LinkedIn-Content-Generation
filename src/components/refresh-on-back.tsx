'use client'

import { useRouter } from 'next/navigation'
import {
  Fragment,
  useEffect,
  useState,
  useTransition,
  type ReactNode
} from 'react'

/**
 * Keeps browser Back and Forward from showing data a change has made stale.
 *
 * Next keeps each visited page's server data for Back and Forward. A Server
 * Action that revalidates throws those copies away, but its answer also
 * re-renders the whole page it was called from. The Posts page's actions no
 * longer revalidate: the page keeps its own copy of every post, so each
 * approve or edit paid for a re-render of up to 100 posts that it then
 * ignored. They call markDataChanged instead, and a Back or Forward after a
 * change reloads that page's data here.
 *
 * Pages that keep their own copy of what they were first given (the Posts
 * page does) would not take reloaded data in, so the page is remounted with
 * it once it has arrived.
 */

let changed = false

/** Says the server's data has changed (a post approved, an image replaced, …). */
export function markDataChanged() {
  changed = true
}

export function RefreshOnBack({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  const [wasRefreshing, setWasRefreshing] = useState(false)
  const [generation, setGeneration] = useState(0)
  if (isRefreshing !== wasRefreshing) {
    setWasRefreshing(isRefreshing)
    if (!isRefreshing) setGeneration(g => g + 1)
  }

  useEffect(() => {
    const onPopState = () => {
      if (!changed) return
      // Next restores the page in its own popstate listener, which runs
      // after this one; the reload has to come after that.
      setTimeout(() => startRefresh(() => router.refresh()), 0)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [router])

  return <Fragment key={generation}>{children}</Fragment>
}
