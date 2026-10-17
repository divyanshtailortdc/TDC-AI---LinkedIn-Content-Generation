import { ErrorState } from '@/components/error-state'

/** Any URL that matches no route. */
export default function NotFound() {
  return (
    <ErrorState
      variant="not-found"
      className="min-h-screen"
      title="Page not found"
      message="This page does not exist. Check the address, or head back to the dashboard."
    />
  )
}
