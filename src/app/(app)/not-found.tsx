import { ErrorState } from '@/components/error-state'

/**
 * For notFound() in an app page (a run or identity that no longer exists),
 * shown inside the app shell so the sidebar stays available.
 */
export default function AppNotFound() {
  return (
    <ErrorState
      variant="not-found"
      className="h-[calc(100vh-4rem)]"
      title="Not found"
      message="This item does not exist or was deleted. It may belong to another identity."
    />
  )
}
