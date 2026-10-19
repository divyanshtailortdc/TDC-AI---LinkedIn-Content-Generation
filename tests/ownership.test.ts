import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import { after, before, describe, it } from 'node:test'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import {
  findOwnedAccount,
  findOwnedIdea,
  findOwnedRun
} from '../src/lib/ownership'

// Needs the auth migrations (0014 and 0016), so it only runs against a database named
// explicitly in DATABASE_URL (never the .env default, which may be shared).
// Every row it makes is removed.
const url = process.env.DATABASE_URL

describe(
  'identities and their data are scoped to their owner',
  { skip: !url },
  () => {
    const client = postgres(url!, { max: 4, prepare: false })
    const database = drizzle(client, { schema })
    const tag = `qa-own-${Date.now().toString(36)}`
    const ids = {
      userA: '',
      userB: '',
      accountA: '',
      accountB: '',
      legacy: '',
      runB: '',
      ideaB: '',
      ideaA: ''
    }

    const makeUser = async (suffix: string) => {
      const [row] = await database
        .insert(schema.authUsersTable)
        .values({
          name: `QA ${suffix}`,
          email: `${tag}-${suffix}@example.test`
        })
        .returning()
      return row!.id
    }
    const makeAccount = async (userId: string | null, handle: string) => {
      const [row] = await database
        .insert(schema.accountsTable)
        .values({ userId, name: `QA ${handle}`, handle, headline: 'QA' })
        .returning()
      return row!.id
    }

    before(async () => {
      ids.userA = await makeUser('a')
      ids.userB = await makeUser('b')
      // The same handle for both users: handles are not unique.
      ids.accountA = await makeAccount(ids.userA, `${tag}-shared`)
      ids.accountB = await makeAccount(ids.userB, `${tag}-shared`)
      ids.legacy = await makeAccount(null, `${tag}-legacy`)
      const [run] = await database
        .insert(schema.runsTable)
        .values({ accountId: ids.accountB, status: 'completed' })
        .returning()
      ids.runB = run!.id
      const [ideaB] = await database
        .insert(schema.ideasTable)
        .values({ accountId: ids.accountB, runId: ids.runB, hook: 'B' })
        .returning()
      ids.ideaB = ideaB!.id
      const [ideaA] = await database
        .insert(schema.ideasTable)
        .values({ accountId: ids.accountA, hook: 'A' })
        .returning()
      ids.ideaA = ideaA!.id
    })

    after(async () => {
      // Deleting the users cascades to their identities, runs and ideas.
      await database
        .delete(schema.authUsersTable)
        .where(
          inArray(
            schema.authUsersTable.id,
            [ids.userA, ids.userB].filter(Boolean)
          )
        )
      if (ids.legacy) {
        await database
          .delete(schema.accountsTable)
          .where(eq(schema.accountsTable.id, ids.legacy))
      }
      await client.end()
    })

    it('finds an identity for its owner only', async () => {
      assert.strictEqual(
        (await findOwnedAccount(database, ids.userA, ids.accountA))?.id,
        ids.accountA
      )
      assert.strictEqual(
        await findOwnedAccount(database, ids.userA, ids.accountB),
        undefined
      )
      assert.strictEqual(
        await findOwnedAccount(database, ids.userA, ids.legacy),
        undefined
      )
    })

    it('answers a missing, malformed and foreign id the same way', async () => {
      for (const id of [
        ids.accountB,
        crypto.randomUUID(),
        'not-a-uuid',
        undefined,
        "' or 1=1 --"
      ]) {
        assert.strictEqual(
          await findOwnedAccount(database, ids.userA, id),
          undefined
        )
      }
    })

    it('scopes runs and ideas through their identity', async () => {
      assert.strictEqual(
        await findOwnedRun(database, ids.userA, ids.runB),
        undefined
      )
      assert.strictEqual(
        (await findOwnedRun(database, ids.userB, ids.runB))?.id,
        ids.runB
      )
      assert.strictEqual(
        await findOwnedIdea(database, ids.userA, ids.ideaB),
        undefined
      )
      assert.strictEqual(
        (await findOwnedIdea(database, ids.userA, ids.ideaA))?.id,
        ids.ideaA
      )
      assert.strictEqual(
        await findOwnedIdea(database, ids.userA, 'nope'),
        undefined
      )
    })

    it('lets a user own only one identity', async () => {
      await assert.rejects(
        makeAccount(ids.userA, `${tag}-second`),
        (err: any) => (err?.code ?? err?.cause?.code) === '23505'
      )
    })

    it('allows any number of unowned legacy identities', async () => {
      const second = await makeAccount(null, `${tag}-legacy-2`)
      await database
        .delete(schema.accountsTable)
        .where(eq(schema.accountsTable.id, second))
    })

    it('deletes a user’s identities with the user', async () => {
      const userC = await makeUser('c')
      const accountC = await makeAccount(userC, `${tag}-c`)
      await database
        .delete(schema.authUsersTable)
        .where(eq(schema.authUsersTable.id, userC))
      const [left] = await database
        .select()
        .from(schema.accountsTable)
        .where(eq(schema.accountsTable.id, accountC))
      assert.strictEqual(left, undefined)
    })
  }
)
