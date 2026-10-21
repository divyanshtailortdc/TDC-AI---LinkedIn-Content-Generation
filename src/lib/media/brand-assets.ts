import 'server-only'

import { db } from '@/db'
import { brandThemesTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import type { ResolvedBrandTheme } from '~/lib/brand/theme'
import { decodeImageDataUrl } from './brand-logo'

/** How an image should be branded: the theme's colours, and the logo file. */
export interface BrandRendering {
  theme: ResolvedBrandTheme
  /** The uploaded logo, decoded; null when none was uploaded. */
  logo: Buffer | null
}

/** The uploaded logo file, decoded; null when none was uploaded. */
export async function loadBrandLogo(accountId: string): Promise<Buffer | null> {
  const [row] = await db
    .select({ logoImage: brandThemesTable.logoImage })
    .from(brandThemesTable)
    .where(eq(brandThemesTable.accountId, accountId))
    .limit(1)
  return row?.logoImage
    ? (decodeImageDataUrl(row.logoImage)?.buffer ?? null)
    : null
}

/**
 * The branding for one image. Every generated image gets the colours and,
 * when one was uploaded, the logo.
 */
export async function loadBrandRendering(
  accountId: string,
  theme: ResolvedBrandTheme
): Promise<BrandRendering> {
  return {
    theme,
    logo: theme.hasLogo ? await loadBrandLogo(accountId) : null
  }
}
