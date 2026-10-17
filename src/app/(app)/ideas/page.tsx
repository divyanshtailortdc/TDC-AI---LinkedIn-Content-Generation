import { Suspense } from 'react'
import { IdeasClient } from './ideas-client'
import { countIdeas, loadIdeasPage } from './ideas-data'
import { getActiveAccount } from '@/lib/active-account'
import { NoActiveAccount } from '@/components/no-active-account'

export const dynamic = 'force-dynamic'

export default async function IdeasPage() {
  const activeAccount = await getActiveAccount()

  if (!activeAccount) {
    return <NoActiveAccount title="Idea Approval Gate" />
  }

  const [{ ideas, nextCursor }, total] = await Promise.all([
    loadIdeasPage(activeAccount.id),
    countIdeas(activeAccount.id)
  ])

  // Keying on the active account forces a remount on switch, so this client
  // component's local state (which only seeds from initialIdeas once) resets
  // and reflects the newly active account's data instead of stale state.
  // IdeasClient reads the status filter with useSearchParams, which needs a
  // Suspense boundary above it (as on the Posts page).
  return (
    <Suspense>
      <IdeasClient
        key={activeAccount.id}
        initialIdeas={ideas}
        initialNextCursor={nextCursor}
        totalIdeas={total}
        activeAccount={activeAccount}
      />
    </Suspense>
  )
}
