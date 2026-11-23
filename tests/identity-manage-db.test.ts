import { eq, getTableName, inArray, sql } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import fs from 'node:fs'
import { after, before, beforeEach, describe, it } from 'node:test'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import {
  deleteIdentityData,
  IdentityDeleteBlockedError,
  listIdentityOverviews
} from '../src/lib/identity-manage'

// Runs against the local development database. Everything it makes hangs off
// two test users, removed at the end (accounts cascade from them).
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]
const tag = `qa-identities-${Date.now().toString(36)}`

describe(
  'the Identities page: listing and deleting identities',
  { skip: !url },
  () => {
    const client = postgres(url!, {
      max: 2,
      prepare: false,
      onnotice: () => {}
    })
    const db = drizzle(client, { schema })
    let userId = ''
    let otherUserId = ''
    let zomatoId = ''
    let keptId = ''
    let draftIds: string[] = []

    async function newDraft(accountId: string, hook: string) {
      const [draft] = await db
        .insert(schema.postDraftsTable)
        .values({
          accountId,
          hook,
          body: 'Body',
          originalHook: hook,
          originalBody: 'Body'
        })
        .returning({ id: schema.postDraftsTable.id })
      return draft!.id
    }

    function publication(
      draftId: string,
      status: 'scheduled' | 'publishing' | 'published',
      metadata: Record<string, unknown> = {}
    ) {
      return {
        userId,
        accountId: zomatoId,
        draftId,
        trigger: 'scheduled' as const,
        status,
        scheduledAt: new Date(Date.now() + 3600_000),
        nextAttemptAt: new Date(Date.now() + 3600_000),
        metadata
      }
    }

    /** An identity with something in most tables, one kept beside it. */
    async function seed() {
      const old = new Date(Date.now() - 60_000)
      const [zomato, kept] = await db
        .insert(schema.accountsTable)
        .values([
          {
            userId,
            name: 'Zomato',
            accountType: 'company',
            handle: 'zomato',
            headline: 'Food delivery',
            createdAt: old
          },
          { userId, name: 'Priya Rao', handle: 'priya', headline: 'Founder' }
        ])
        .returning()
      zomatoId = zomato!.id
      keptId = kept!.id

      await db.insert(schema.goalsTable).values([
        { accountId: zomatoId, title: 'Cravings', keyMessage: 'Late night' },
        { accountId: zomatoId, title: 'Riders', keyMessage: 'Partners' },
        { accountId: keptId, title: 'Hiring', keyMessage: 'Join us' }
      ])
      await db.insert(schema.knowledgeDocumentsTable).values({
        accountId: zomatoId,
        title: 'About Zomato',
        sourceType: 'text',
        content: 'Food delivery'
      })
      const [run] = await db
        .insert(schema.runsTable)
        .values({ accountId: zomatoId, status: 'completed' })
        .returning()
      await db.insert(schema.ideasTable).values([
        {
          accountId: zomatoId,
          runId: run!.id,
          hook: 'Fries again',
          status: 'proposed'
        },
        {
          accountId: zomatoId,
          runId: run!.id,
          hook: 'Rider stories',
          status: 'drafted'
        }
      ])
      draftIds = [
        await newDraft(zomatoId, 'Scheduled'),
        await newDraft(zomatoId, 'Claimed, not sent'),
        await newDraft(zomatoId, 'Published')
      ]
      await db
        .insert(schema.publicationsTable)
        .values([
          publication(draftIds[0]!, 'scheduled'),
          publication(draftIds[1]!, 'publishing'),
          publication(draftIds[2]!, 'published')
        ])
      await newDraft(keptId, 'Priya’s post')
      await db.insert(schema.platformConnectionsTable).values({
        userId,
        accountId: zomatoId,
        platform: 'instagram',
        memberId: `${tag}-ig`,
        name: 'zomato'
      })
      await db
        .insert(schema.inboundAddressesTable)
        .values({ accountId: zomatoId, localPart: `${tag}-zomato` })
      await db.insert(schema.aiUsageTable).values({
        userId,
        accountId: zomatoId,
        source: 'runs',
        stage: 'ideation',
        model: 'test',
        costUsd: '0.5'
      })
    }

    const accountExists = async (id: string) =>
      (
        await db
          .select({ id: schema.accountsTable.id })
          .from(schema.accountsTable)
          .where(eq(schema.accountsTable.id, id))
      ).length === 1

    before(async () => {
      const users = await db
        .insert(schema.authUsersTable)
        .values([
          { name: 'QA Identities', email: `${tag}@example.test` },
          { name: 'QA Other', email: `${tag}-other@example.test` }
        ])
        .returning()
      userId = users[0]!.id
      otherUserId = users[1]!.id
    })
    beforeEach(async () => {
      await db
        .delete(schema.accountsTable)
        .where(eq(schema.accountsTable.userId, userId))
      // Spend outlives its identity, so an earlier test's row is still here.
      await db
        .delete(schema.aiUsageTable)
        .where(eq(schema.aiUsageTable.userId, userId))
      await db
        .delete(schema.inboundAddressesTable)
        .where(eq(schema.inboundAddressesTable.localPart, `${tag}-zomato`))
      await seed()
    })
    after(async () => {
      await db
        .delete(schema.inboundAddressesTable)
        .where(eq(schema.inboundAddressesTable.localPart, `${tag}-zomato`))
      await db
        .delete(schema.aiUsageTable)
        .where(eq(schema.aiUsageTable.userId, userId))
      await db
        .delete(schema.authUsersTable)
        .where(inArray(schema.authUsersTable.id, [userId, otherUserId]))
      await client.end()
    })

    it('lists the user’s identities oldest first, with what each holds', async () => {
      const list = await listIdentityOverviews(db, userId)
      assert.deepStrictEqual(
        list.map(i => i.name),
        ['Zomato', 'Priya Rao']
      )
      const zomato = list[0]!
      assert.strictEqual(zomato.accountType, 'company')
      assert.deepStrictEqual(
        {
          posts: zomato.posts,
          scheduled: zomato.scheduled,
          published: zomato.published,
          ideas: zomato.ideas,
          goals: zomato.goals,
          knowledge: zomato.knowledge,
          runs: zomato.runs,
          connections: zomato.connections
        },
        {
          posts: 3,
          scheduled: 1,
          published: 1,
          ideas: 2,
          goals: 2,
          knowledge: 1,
          runs: 1,
          connections: 1
        }
      )
      assert.strictEqual(list[1]!.posts, 1)
      assert.strictEqual(list[1]!.goals, 1)
      assert.deepStrictEqual(await listIdentityOverviews(db, otherUserId), [])
    })

    it('deletes the identity and everything in it, and nothing else', async () => {
      const result = await deleteIdentityData(db, userId, zomatoId, {
        publishing: true
      })
      assert.strictEqual(result?.name, 'Zomato')
      assert.deepStrictEqual([...result.draftIds].sort(), [...draftIds].sort())

      assert.strictEqual(await accountExists(zomatoId), false)
      const tables: Array<PgTable & { accountId: AnyPgColumn }> = [
        schema.goalsTable,
        schema.ideasTable,
        schema.runsTable,
        schema.knowledgeDocumentsTable,
        schema.postDraftsTable,
        schema.publicationsTable,
        schema.platformConnectionsTable
      ]
      for (const table of tables) {
        const [row] = await db.execute<{ n: number }>(
          sql`select count(*)::int as n from ${table} where ${table.accountId} = ${zomatoId}`
        )
        assert.strictEqual(row?.n, 0, `rows left in ${getTableName(table)}`)
      }

      // The other identity is untouched.
      assert.strictEqual(await accountExists(keptId), true)
      const [kept] = await listIdentityOverviews(db, userId)
      assert.strictEqual(kept?.id, keptId)
      assert.strictEqual(kept?.posts, 1)
      assert.strictEqual(kept?.goals, 1)

      // Its address stays, emptied, so nobody else is given it; its spend stays.
      const [address] = await db
        .select()
        .from(schema.inboundAddressesTable)
        .where(eq(schema.inboundAddressesTable.localPart, `${tag}-zomato`))
      assert.ok(address)
      assert.strictEqual(address.accountId, null)
      const spend = await db
        .select()
        .from(schema.aiUsageTable)
        .where(eq(schema.aiUsageTable.userId, userId))
      assert.strictEqual(spend.length, 1)
      assert.strictEqual(spend[0]!.accountId, null)
    })

    it('treats another user’s identity as not found', async () => {
      const result = await deleteIdentityData(db, otherUserId, zomatoId, {
        publishing: true
      })
      assert.strictEqual(result, null)
      assert.strictEqual(await accountExists(zomatoId), true)
    })

    it('changes nothing while a run is working', async () => {
      await db
        .insert(schema.runsTable)
        .values({ accountId: zomatoId, status: 'researching' })
      await assert.rejects(
        deleteIdentityData(db, userId, zomatoId, { publishing: true }),
        (err: Error) =>
          err instanceof IdentityDeleteBlockedError &&
          /then delete it/.test(err.message)
      )
      assert.strictEqual(await accountExists(zomatoId), true)
    })

    it('changes nothing while one of its posts is being sent', async () => {
      // The claimed one was marked: its create request may be out.
      await db
        .update(schema.publicationsTable)
        .set({ metadata: { postRequestedAt: new Date().toISOString() } })
        .where(eq(schema.publicationsTable.draftId, draftIds[1]!))
      await assert.rejects(
        deleteIdentityData(db, userId, zomatoId, { publishing: true }),
        (err: Error) =>
          err instanceof IdentityDeleteBlockedError &&
          /being published/.test(err.message)
      )
      assert.strictEqual(await accountExists(zomatoId), true)
      // Rolled back: the scheduled post is still waiting.
      const [scheduled] = await db
        .select({ status: schema.publicationsTable.status })
        .from(schema.publicationsTable)
        .where(eq(schema.publicationsTable.draftId, draftIds[0]!))
      assert.strictEqual(scheduled?.status, 'scheduled')
    })
  }
)
