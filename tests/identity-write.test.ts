import assert from 'node:assert'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import { insertIdentity, updateIdentity } from '../src/lib/identity-write'

// Runs against the local development database; every row it makes is removed.
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]
const handle = `qa-tx-${Date.now().toString(36)}`

describe('identity writes are all or nothing', { skip: !url }, () => {
  const client = postgres(url!, { max: 2, prepare: false })
  const database = drizzle(client, { schema })
  const account = (h: string) => ({
    name: 'QA Tx',
    accountType: 'personal' as const,
    handle: h,
    headline: 'QA',
    bio: 'QA',
    industry: 'Finance'
  })
  const profile = { offerings: 'Bookkeeping', targetAudience: 'D2C founders' }

  before(async () => {
    await client`delete from accounts where handle like 'qa-tx-%'`
  })
  after(async () => {
    await client`delete from accounts where handle like 'qa-tx-%'`
    await client.end()
  })

  it('creates the account with its offering and audience', async () => {
    const created = await insertIdentity(database, account(handle), profile)
    const [offerings, audiences] = await Promise.all([
      database.select().from(schema.offeringsTable).where(eq(schema.offeringsTable.accountId, created.id)),
      database.select().from(schema.audiencesTable).where(eq(schema.audiencesTable.accountId, created.id))
    ])
    assert.equal(offerings.length, 1)
    assert.equal(audiences[0]?.name, 'D2C founders')
  })

  it('leaves no account behind when a later write fails', async () => {
    // Postgres rejects NUL in text, so the offering insert fails after the
    // account insert has already succeeded.
    await assert.rejects(
      insertIdentity(database, account(`${handle}-x`), {
        offerings: 'bad\u0000text',
        targetAudience: 'anyone'
      })
    )
    const rows = await client`select id from accounts where handle = ${`${handle}-x`}`
    assert.equal(rows.length, 0)
  })

  it('keeps the old account details when an update fails part way', async () => {
    const [row] = await client`select id from accounts where handle = ${handle}`
    await assert.rejects(
      updateIdentity(database, row!.id, { name: 'Changed' }, {
        offerings: 'bad\u0000text',
        targetAudience: 'anyone'
      })
    )
    const [after] = await client`select name from accounts where id = ${row!.id}`
    assert.equal(after!.name, 'QA Tx')
  })
})
