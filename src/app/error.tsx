'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'
import { ErrorState } from '@/components/error-state'

/**
 * Catches what (app)/error.tsx cannot: an error in the app shell's own layout
 * (the sidebar and its queries), so it is shown without the shell.
 */
export default function RootError({
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
      className="min-h-screen"
      title="Something went wrong"
      message="The app could not be loaded. Try again in a moment."
      digest={error.digest}
      onRetry={retry}
    />
  )
}
