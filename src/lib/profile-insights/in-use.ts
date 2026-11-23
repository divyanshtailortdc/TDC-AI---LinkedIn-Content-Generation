import type { Account } from '@/db/schema'
import { isPlatformId } from '@/lib/formats'
import { linkStaysAfterChange } from '@/lib/identity-change'
import type { PlatformInsights } from './render'
import { cleanProfileInsights } from './types'

/** A platform_insights row as generation reads it. */
export type InsightRow = {
  platform: string
  profileUrl: string
  insights: unknown
}

/**
 * The analyses generation may use for an identity, by platform: every one
 * with something learned (a failed refresh keeps the insights from before),
 * except, while the profile names another company than the rest of its
 * context was set up for (accounts.context_identity), those of links that
 * still look more like the old company's than the new one's. Those links are
 * the old company's, and what was learned from them would make its posts
 * sound like that company until the identity is switched over
 * (src/lib/identity-switch.ts).
 */
export function insightsInUse(
  rows: InsightRow[],
  account: IdentityNow
): PlatformInsights {
  const out: PlatformInsights = {}
  for (const row of rows) {
    if (!isPlatformId(row.platform)) continue
    const insights = cleanProfileInsights(row.insights)
    if (!insights) continue
    if (!usesLearnedLink(row.profileUrl, account)) continue
    out[row.platform] = insights
  }
  return out
}

type IdentityNow = Pick<Account, 'name' | 'company' | 'websiteUrl' | 'contextIdentity'>

/**
 * Whether what was learned from `profileUrl` may be used: always, unless the
 * identity was renamed to another company and the link is still more the
 * old company's than the new one's (linkStaysAfterChange). The Profile page
 * lists the links this holds back.
 */
export function usesLearnedLink(profileUrl: string, account: IdentityNow): boolean {
  return (
    !account.contextIdentity ||
    linkStaysAfterChange(profileUrl, account.contextIdentity, account)
  )
}
