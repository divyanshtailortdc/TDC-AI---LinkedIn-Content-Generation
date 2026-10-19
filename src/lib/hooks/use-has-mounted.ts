'use client'

import { useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}

/**
 * False during SSR and the hydration render, true afterwards. Lets text that
 * depends on the browser (its time zone, "now") render only on the client
 * without tripping a hydration mismatch.
 */
export function useHasMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )
}
