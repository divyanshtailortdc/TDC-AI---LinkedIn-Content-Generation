'use server'

import { db } from '@/db'
import { brandThemesTable } from '@/db/schema'
import {
  BRAND_THEME_PATH,
  BrandThemePayloadSchema,
  type BrandThemePayload
} from '@/lib/brand/theme'
import { requireIdentityId } from '@/lib/identity'
import { normalizeLogo } from '@/lib/media/brand-logo'
import { requireUser } from '@/lib/session'
import { parseSetupPayload } from '@/lib/setup-payloads'
import { revalidatePath } from 'next/cache'

/**
 * Saves the identity's brand theme: its logo and two colours. The logo comes
 * as a data URL from the form (undefined keeps the saved file, null removes
 * it) and is decoded and re-encoded here, so whatever is stored is a real
 * image of a sane size.
 */
export async function saveBrandTheme(rawPayload: BrandThemePayload) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const payload = parseSetupPayload(BrandThemePayloadSchema, rawPayload)

    const columns = {
      primaryColor: payload.primaryColor,
      secondaryColor: payload.secondaryColor,
      ...(payload.logo !== undefined && {
        logoImage: payload.logo && (await normalizeLogo(payload.logo)).dataUrl
      }),
      updatedAt: new Date()
    }

    // One row per identity (UNIQUE account_id): a second save updates it.
    await db
      .insert(brandThemesTable)
      .values({ accountId, ...columns })
      .onConflictDoUpdate({ target: brandThemesTable.accountId, set: columns })

    revalidatePath(BRAND_THEME_PATH)
    revalidatePath('/posts')
    return { success: true as const }
  } catch (err) {
    return {
      success: false as const,
      error:
        err instanceof Error ? err.message : 'Could not save the brand theme.'
    }
  }
}
