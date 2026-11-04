import 'server-only'

import { db } from '@/db'
import {
  accountsTable,
  authUsersTable,
  inboundAddressesTable
} from '@/db/schema'
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { addressCandidates, localPartError } from './local-part'

/**
 * Each workspace's inbound address; named after
 * the person who owns the workspace (the name and email they sign in with),
 * never after the LinkedIn identity it writes as, so editing that identity
 * leaves the address alone. They can choose another on the Inbox page.
 *
 * Only the part before the @ is stored; the domain is INBOUND_EMAIL_DOMAIN.
 * Nothing is created on the mail server, which accepts every address at the
 * domain; the app decides which ones belong to a workspace.
 *
 * An address is never given to anyone else: one that was replaced still
 * delivers to its workspace, and one whose workspace was deleted stays taken.
 * Newsletters send sign-in links to it, which must not reach a stranger.
 */

const addresses = inboundAddressesTable

/** Counting replaced ones, so one workspace cannot hold many names. */
const MAX_ADDRESSES_PER_WORKSPACE = 5

const TAKEN = 'That address is taken. Please choose another.'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function currentLocalPart(accountId: string) {
  const [row] = await db
    .select({ localPart: addresses.localPart })
    .from(addresses)
    .where(
      and(eq(addresses.accountId, accountId), isNull(addresses.replacedAt))
    )
    .limit(1)
  return row?.localPart ?? null
}

/** The signed-in user who owns the workspace, or null for a legacy one without. */
async function accountHolder(accountId: string) {
  const [holder] = await db
    .select({ name: authUsersTable.name, email: authUsersTable.email })
    .from(accountsTable)
    .innerJoin(authUsersTable, eq(authUsersTable.id, accountsTable.userId))
    .where(eq(accountsTable.id, accountId))
    .limit(1)
  return holder ?? null
}

async function takenLocalParts(localParts: string[]) {
  if (localParts.length === 0) return new Set<string>()
  const rows = await db
    .select({ localPart: addresses.localPart })
    .from(addresses)
    .where(inArray(addresses.localPart, localParts))
  return new Set(rows.map(row => row.localPart))
}

/**
 * The workspace's address, created on first use from its owner's name: the
 * first of addressCandidates that nobody has. Null when none is free or no
 * name can be made from theirs; they then choose one (chooseInboundAddress).
 */
export async function ensureInboundAddress(
  accountId: string,
  domain: string
): Promise<string | null> {
  const existing = await currentLocalPart(accountId)
  if (existing) return `${existing}@${domain}`

  const holder = await accountHolder(accountId)
  const candidates = holder ? addressCandidates(holder) : []
  for (let attempt = 0; attempt < 3; attempt++) {
    const taken = await takenLocalParts(candidates)
    const localPart = candidates.find(candidate => !taken.has(candidate))
    if (!localPart) return null
    const [created] = await db
      .insert(addresses)
      .values({ accountId, localPart })
      .onConflictDoNothing()
      .returning({ localPart: addresses.localPart })
    if (created) return `${created.localPart}@${domain}`
    // Either a request gave this workspace its address meanwhile, which is
    // kept, or someone else took this name, and the next free one is tried.
    const raced = await currentLocalPart(accountId)
    if (raced) return `${raced}@${domain}`
  }
  throw new Error('Could not create an inbound address. Please try again.')
}

/** The workspace's earlier addresses, which still deliver to it; newest first. */
export async function replacedInboundAddresses(
  accountId: string,
  domain: string
): Promise<string[]> {
  const rows = await db
    .select({ localPart: addresses.localPart })
    .from(addresses)
    .where(
      and(eq(addresses.accountId, accountId), isNotNull(addresses.replacedAt))
    )
    .orderBy(desc(addresses.replacedAt))
  return rows.map(row => `${row.localPart}@${domain}`)
}

/** Makes `id` the workspace's current address and replaces the one before it. */
async function makeCurrent(tx: Tx, accountId: string, id: string) {
  await tx
    .update(addresses)
    .set({ replacedAt: new Date() })
    .where(
      and(eq(addresses.accountId, accountId), isNull(addresses.replacedAt))
    )
  await tx
    .update(addresses)
    .set({ replacedAt: null })
    .where(eq(addresses.id, id))
}

/**
 * Makes `localPart` the workspace's address, or says why it cannot: the
 * reason in words for the form, or null once done. The address it had keeps
 * delivering, so newsletters already subscribed with it still arrive, and
 * choosing it again makes it current again.
 */
export async function chooseInboundAddress(
  accountId: string,
  localPart: string
): Promise<string | null> {
  const invalid = localPartError(localPart)
  if (invalid) return invalid

  return db.transaction(async tx => {
    // One change at a time per workspace, so the limit below holds.
    await tx
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .for('update')
    const owned = await tx
      .select({
        id: addresses.id,
        localPart: addresses.localPart,
        replacedAt: addresses.replacedAt
      })
      .from(addresses)
      .where(eq(addresses.accountId, accountId))

    const mine = owned.find(row => row.localPart === localPart)
    if (mine) {
      if (mine.replacedAt !== null) await makeCurrent(tx, accountId, mine.id)
      return null
    }
    if (owned.length >= MAX_ADDRESSES_PER_WORKSPACE) {
      return `A workspace can have at most ${MAX_ADDRESSES_PER_WORKSPACE} addresses. Choose one of your earlier ones.`
    }
    // Added as replaced first, so it cannot clash with the current address.
    const [created] = await tx
      .insert(addresses)
      .values({ accountId, localPart, replacedAt: new Date() })
      .onConflictDoNothing()
      .returning({ id: addresses.id })
    if (!created) return TAKEN
    await makeCurrent(tx, accountId, created.id)
    return null
  })
}

/**
 * Workspace ids by the (lower-case) local parts mail was delivered to, for
 * current and replaced addresses alike. Those of deleted workspaces match
 * nothing.
 */
export async function identitiesByLocalPart(
  localParts: string[]
): Promise<Map<string, string>> {
  if (localParts.length === 0) return new Map()
  const rows = await db
    .select({ localPart: addresses.localPart, accountId: addresses.accountId })
    .from(addresses)
    .where(inArray(addresses.localPart, [...new Set(localParts)]))
  return new Map(
    rows.flatMap(row =>
      row.accountId ? [[row.localPart, row.accountId] as const] : []
    )
  )
}
