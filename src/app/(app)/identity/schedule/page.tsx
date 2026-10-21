import { redirect } from 'next/navigation'

/** The schedule has its own page now; keep old links working. */
export default function IdentitySchedulePage() {
  redirect('/schedule')
}
