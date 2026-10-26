import { NoIdentity } from '@/components/no-identity'
import { db } from '@/db'
import { brandThemesTable } from '@/db/schema'
import { resolveBrandTheme } from '@/lib/brand/theme'
import { getIdentity } from '@/lib/identity'
import { eq, sql } from 'drizzle-orm'
import { BrandThemeClient } from './brand-theme-client'

export const dynamic = 'force-dynamic'

export default async function BrandThemePage() {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Brand Theme" />

  const [row] = await db
    .select({
      primaryColor: brandThemesTable.primaryColor,
      accentColor: brandThemesTable.accentColor,
      backgroundColor: brandThemesTable.backgroundColor,
      headingFont: brandThemesTable.headingFont,
      bodyFont: brandThemesTable.bodyFont,
      visualStyle: brandThemesTable.visualStyle,
      backgroundPattern: brandThemesTable.backgroundPattern,
      showLogo: brandThemesTable.showLogo,
      footerText: brandThemesTable.footerText,
      // Never the logo itself: the page links to it (api/brand/logo).
      hasLogo: sql<boolean>`${brandThemesTable.logoImage} is not null`,
      updatedAt: brandThemesTable.updatedAt
    })
    .from(brandThemesTable)
    .where(eq(brandThemesTable.accountId, identity.id))
    .limit(1)
  const theme = resolveBrandTheme(row)

  return (
    <BrandThemeClient
      identityName={identity.name}
      initialTheme={theme}
      initialLogo={
        row?.hasLogo ? `/api/brand/logo?v=${row.updatedAt.getTime()}` : null
      }
    />
  )
}
