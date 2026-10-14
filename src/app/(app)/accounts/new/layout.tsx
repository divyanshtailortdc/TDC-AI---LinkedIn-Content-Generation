import { getActiveAccount } from '@/lib/active-account'
import { redirect } from 'next/navigation'

/**
 * The workspace keeps a single identity, so creating another is only
 * possible when none is active; otherwise this opens the existing one.
 */
export default async function NewAccountLayout({
  children
}: {
  children: React.ReactNode
}) {
  const existing = await getActiveAccount()
  if (existing) redirect(`/accounts/${existing.id}`)
  return children
}
