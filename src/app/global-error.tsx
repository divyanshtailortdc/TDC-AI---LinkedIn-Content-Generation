'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'
import { ErrorState } from '@/components/error-state'
import './globals.css'

/**
 * The last resort, for an error in the root layout itself. It replaces that
 * layout, so it brings its own <html>, <body> and styles; the theme follows
 * the OS setting because the app's theme provider is not running here.
 */
export default function GlobalError({
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
    <html lang="en" className="h-full antialiased">
      <body className="h-full">
        <title>Something went wrong</title>
        <ErrorState
          className="min-h-screen"
          title="Something went wrong"
          message="The app could not be loaded. Try again in a moment."
          digest={error.digest}
          onRetry={retry}
        />
      </body>
    </html>
  )
}
