import { db } from '@/db'
import { getIdentity } from '@/lib/identity'
import { listIdentityOverviews } from '@/lib/identity-manage'
import { requireUser } from '@/lib/session'
import { IdentitiesClient } from './identities-client'

export const dynamic = 'force-dynamic'

export default async function IdentitiesPage() {
  const user = await requireUser()
  const [identities, active] = await Promise.all([
    listIdentityOverviews(db, user.id),
    getIdentity()
  ])
  return (
    <IdentitiesClient identities={identities} activeId={active?.id ?? null} />
  )
}
