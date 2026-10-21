import { NoIdentity } from '@/components/no-identity'
import { db } from '@/db'
import { brandThemesTable } from '@/db/schema'
import { resolveBrandTheme } from '@/lib/brand/theme'
import { getIdentity } from '@/lib/identity'
import { eq } from 'drizzle-orm'
import { BrandThemeClient } from './brand-theme-client'

export const dynamic = 'force-dynamic'

export default async function BrandThemePage() {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Brand Theme" />

  const [row] = await db
    .select({
      logoImage: brandThemesTable.logoImage,
      primaryColor: brandThemesTable.primaryColor,
      secondaryColor: brandThemesTable.secondaryColor
    })
    .from(brandThemesTable)
    .where(eq(brandThemesTable.accountId, identity.id))
    .limit(1)
  const theme = resolveBrandTheme(
    row ? { ...row, hasLogo: Boolean(row.logoImage) } : null
  )

  return (
    <BrandThemeClient
      identityName={identity.name}
      initialColors={{
        primary: theme.primaryColor,
        secondary: theme.secondaryColor
      }}
      initialLogo={row?.logoImage ?? null}
    />
  )
}
