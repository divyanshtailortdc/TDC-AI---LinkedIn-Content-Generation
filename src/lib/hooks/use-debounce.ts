//todo: can we remove this

'use client'

import { useCallback, useRef } from 'react'

/**
 * Returns a debounced version of the provided callback.
 * The debounced function delays invoking the callback until
 * after `delay` ms have elapsed since the last invocation.
 *
 * @example
 * const debouncedSearch = useDebounce((query: string) => {
 *   fetchResults(query)
 * }, 300)
 */
export function useDebounce<T extends (...args: Parameters<T>) => void>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args)
      }, delay)
    },
    [callback, delay]
  ) as T
}
