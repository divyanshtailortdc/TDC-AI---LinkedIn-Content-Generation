import 'server-only'

import { db } from '@/db'
import { inboundAddressesTable } from '@/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { randomInt } from 'node:crypto'

/**
 * Each identity's inbound address, e.g. `priya-rao-k7x2@in.example.com`:
 * its handle, plus four random characters so addresses cannot be guessed and
 * spammed. Nothing is created on the mail server, which accepts every address
 * at the domain; the app decides which ones belong to an identity.
 */

const addresses = inboundAddressesTable

const SUFFIX_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

/** The handle as an address local part: a–z, 0–9 and single hyphens. */
function localPartOf(handle: string) {
  const slug = handle
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '')
  return slug || 'identity'
}

function randomSuffix() {
  return Array.from(
    { length: 4 },
    () => SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)]
  ).join('')
}

async function findAddress(accountId: string) {
  const [row] = await db
    .select({ address: addresses.address })
    .from(addresses)
    .where(eq(addresses.accountId, accountId))
    .limit(1)
  return row?.address ?? null
}

/**
 * The identity's address, created on first use. When INBOUND_EMAIL_DOMAIN has
 * changed since (say from a local test domain to the real one), the address
 * moves to the new domain and keeps its local part.
 */
export async function ensureInboundAddress(
  accountId: string,
  handle: string,
  domain: string
): Promise<string> {
  const existing = await findAddress(accountId)
  if (existing?.endsWith(`@${domain}`)) return existing
  if (existing) {
    const moved = `${existing.slice(0, existing.lastIndexOf('@'))}@${domain}`
    await db
      .update(addresses)
      .set({ address: moved })
      .where(eq(addresses.accountId, accountId))
    return moved
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const address = `${localPartOf(handle)}-${randomSuffix()}@${domain}`
    const [created] = await db
      .insert(addresses)
      .values({ accountId, address })
      .onConflictDoNothing()
      .returning({ address: addresses.address })
    if (created) return created.address
    // Either a request made this identity's address meanwhile, or the random
    // address was taken: the first is kept, the second tried again.
    const raced = await findAddress(accountId)
    if (raced) return raced
  }
  throw new Error('Could not create an inbound address. Please try again.')
}

/** Identity ids by the (lower-case) addresses mail was delivered to. */
export async function identitiesByAddress(
  recipients: string[]
): Promise<Map<string, string>> {
  if (recipients.length === 0) return new Map()
  const rows = await db
    .select({ address: addresses.address, accountId: addresses.accountId })
    .from(addresses)
    .where(inArray(addresses.address, [...new Set(recipients)]))
  return new Map(rows.map(row => [row.address, row.accountId]))
}
