import { requireUser } from '@/lib/session'
import type { Metadata } from 'next'
import { PasskeysSection } from './passkeys-section'

export const metadata: Metadata = {
  title: 'Security · TDC LinkedIn Content Engine'
}

export default async function SecuritySettingsPage() {
  await requireUser()
  // Loaded in the browser: Better Auth refreshes this list by itself after a
  // passkey is added (here or from the sidebar), renamed or deleted.
  return <PasskeysSection />
}
