'use client'

import { useEffect, useSyncExternalStore } from 'react'

/**
 * The sidebar's "ideas to review" count between server renders. Approving or
 * rejecting an idea used to revalidate the whole layout just to update this
 * number, re-rendering the page the reviewer was on with every click. Those
 * actions now adjust it here instead; the next count from the server, which
 * already includes those decisions, replaces the adjustment.
 */

let state = { serverCount: -1, delta: 0 }
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function set(next: typeof state) {
  state = next
  for (const listener of listeners) listener()
}

/** Changes the count shown, e.g. -1 when an idea leaves review. */
export function adjustIdeasToReview(delta: number) {
  if (delta !== 0) set({ ...state, delta: state.delta + delta })
}

/** The count to show, given the server's. For the sidebar. */
export function useIdeasToReview(serverCount: number): number {
  const current = useSyncExternalStore(subscribe, () => state, () => state)
  useEffect(() => {
    if (state.serverCount !== serverCount) set({ serverCount, delta: 0 })
  }, [serverCount])
  const delta = current.serverCount === serverCount ? current.delta : 0
  return Math.max(0, serverCount + delta)
}
