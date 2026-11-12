import {
  accountsTable,
  audiencesTable,
  offeringsTable,
  preferencesTable
} from '@/db/schema'
import { offeringNameFromText, type IdentityProfile } from '@/lib/identity-profile'
import { asc, eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

/**
 * Database writes for an identity's profile. An identity is spread over the
 * accounts, offerings and audiences tables, so each entry point writes all of
 * them in one transaction: a failure part way leaves nothing behind.
 *
 * Takes the database as an argument (rather than importing it) so the writes
 * can be run against any connection.
 */
export type IdentityDb = PgDatabase<PostgresJsQueryResultHKT, any, any>
type Tx = Parameters<Parameters<IdentityDb['transaction']>[0]>[0]
type AccountInsert = typeof accountsTable.$inferInsert
type ProfileRows = Pick<IdentityProfile, 'offerings' | 'targetAudience'>

/**
 * Writes the profile's free-text offerings and audience into the account's
 * primary (oldest) rows, inserting them when missing. Later rows are kept.
 */
async function upsertPrimaryOfferingAndAudience(
  tx: Tx,
  accountId: string,
  profile: ProfileRows
) {
  const [primaryOffering] = await tx
    .select({ id: offeringsTable.id })
    .from(offeringsTable)
    .where(eq(offeringsTable.accountId, accountId))
    .orderBy(asc(offeringsTable.createdAt))
    .limit(1)
  const offeringValues = {
    name: offeringNameFromText(profile.offerings),
    description: profile.offerings
  }
  // Promoting nothing is fine: no offering row is made for that, and an
  // emptied one is switched off so no prompt lists it.
  if (!profile.offerings?.trim()) {
    if (primaryOffering) {
      await tx
        .update(offeringsTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(offeringsTable.id, primaryOffering.id))
    }
  } else if (primaryOffering) {
    await tx
      .update(offeringsTable)
      .set({ ...offeringValues, isActive: true, updatedAt: new Date() })
      .where(eq(offeringsTable.id, primaryOffering.id))
  } else {
    await tx
      .insert(offeringsTable)
      .values({ accountId, ...offeringValues, isActive: true })
  }

  const [primaryAudience] = await tx
    .select({ id: audiencesTable.id })
    .from(audiencesTable)
    .where(eq(audiencesTable.accountId, accountId))
    .orderBy(asc(audiencesTable.createdAt))
    .limit(1)
  if (primaryAudience) {
    await tx
      .update(audiencesTable)
      .set({ name: profile.targetAudience, updatedAt: new Date() })
      .where(eq(audiencesTable.id, primaryAudience.id))
  } else {
    await tx
      .insert(audiencesTable)
      .values({ accountId, name: profile.targetAudience })
  }
}

/** Creates the account with its offering and audience, all or nothing. */
export async function insertIdentity(
  database: IdentityDb,
  account: AccountInsert,
  profile: ProfileRows,
  /** Where it posts and how each platform sounds, from setup; none keeps the defaults. */
  channels?: Pick<
    typeof preferencesTable.$inferInsert,
    'enabledFormats' | 'channelSettings'
  > | null
) {
  return database.transaction(async tx => {
    const [inserted] = await tx.insert(accountsTable).values(account).returning()
    if (!inserted) throw new Error('Failed to create account')
    await upsertPrimaryOfferingAndAudience(tx, inserted.id, profile)
    if (channels) {
      await tx.insert(preferencesTable).values({ accountId: inserted.id, ...channels })
    }
    return inserted
  })
}

/** Updates the account with its offering and audience, all or nothing. */
export async function updateIdentity(
  database: IdentityDb,
  accountId: string,
  account: Partial<AccountInsert>,
  profile: ProfileRows
) {
  await database.transaction(async tx => {
    await tx
      .update(accountsTable)
      .set(account)
      .where(eq(accountsTable.id, accountId))
    await upsertPrimaryOfferingAndAudience(tx, accountId, profile)
  })
}
