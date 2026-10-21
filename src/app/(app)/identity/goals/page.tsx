import { redirect } from 'next/navigation'

/** Goals moved out of Account Setup to a page of their own; keep old links working. */
export default function IdentityGoalsPage() {
  redirect('/goals')
}
