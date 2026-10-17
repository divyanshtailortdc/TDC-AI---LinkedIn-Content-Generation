'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'
import { ErrorState } from '@/components/error-state'

/**
 * Shown in place of a page that threw, inside the app shell, so the sidebar
 * and identity switcher stay usable to get out of it. An error in the shell
 * itself (this folder's layout) is caught one level up, by app/error.tsx.
 */
export default function AppError({
  error,
  retry
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <ErrorState
      className="h-[calc(100vh-4rem)]"
      title="Something went wrong"
      message="This page could not be loaded. Try again, or switch identity from the sidebar."
      digest={error.digest}
      onRetry={retry}
    />
  )
}
