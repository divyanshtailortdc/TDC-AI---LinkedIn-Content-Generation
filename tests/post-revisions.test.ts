import assert from 'node:assert'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from '../src/db/schema'
import {
  findRevision,
  listRevisions,
  lockPost,
  saveRevision
} from '../src/lib/post-revisions'

// Runs against the local development database; every row it makes is removed.
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1]
const handle = `qa-rev-${Date.now().toString(36)}`

describe('earlier versions of a post', { skip: !url }, () => {
  const client = postgres(url!, { max: 4, prepare: false })
  const database = drizzle(client, { schema })
  let accountId = ''

  const newPost = async (formatId = 'linkedin.post') => {
    const [post] = await database
      .insert(schema.postDraftsTable)
      .values({
        accountId,
        hook: 'First hook',
        body: 'First body',
        originalHook: 'First hook',
        originalBody: 'First body',
        cta: 'First ask?',
        formatId
      })
      .returning()
    return post!
  }

  /** What an edit does: keep the version it replaces, then overwrite. */
  const edit = (draftId: string, hook: string, body: string) =>
    database.transaction(async tx => {
      const current = await lockPost(tx, draftId)
      const saved = await saveRevision(tx, current!, 'user_edit', {
        next: { hook, body }
      })
      await tx
        .update(schema.postDraftsTable)
        .set({ hook, body })
        .where(eq(schema.postDraftsTable.id, draftId))
      return saved
    })

  before(async () => {
    await client`delete from accounts where handle like 'qa-rev-%'`
    const [account] = await database
      .insert(schema.accountsTable)
      .values({ name: 'QA Revisions', accountType: 'personal', handle, headline: 'QA' })
      .returning()
    accountId = account!.id
  })
  after(async () => {
    await client`delete from accounts where handle like 'qa-rev-%'`
    await client.end()
  })

  it('keeps the replaced text, numbered from 1, newest first', async () => {
    const post = await newPost()
    assert.strictEqual(await edit(post.id, 'Second hook', 'Second body'), true)
    assert.strictEqual(await edit(post.id, 'Third hook', 'Third body'), true)

    const versions = await listRevisions(database, post.id)
    assert.deepStrictEqual(
      versions.map(v => [v.number, v.hook, v.replacedBy]),
      [
        [2, 'Second hook', 'user_edit'],
        [1, 'First hook', 'user_edit']
      ]
    )
    assert.strictEqual(versions[1]!.cta, 'First ask?')
  })

  it('saves nothing when an edit leaves the text as it was', async () => {
    const post = await newPost()
    assert.strictEqual(await edit(post.id, 'First hook', 'First body'), false)
    assert.strictEqual((await listRevisions(database, post.id)).length, 0)
  })

  it('numbers two concurrent edits one after the other', async () => {
    const post = await newPost()
    const results = await Promise.all([
      edit(post.id, 'A hook', 'A body'),
      edit(post.id, 'B hook', 'B body')
    ])
    assert.deepStrictEqual(results, [true, true])
    const numbers = (await listRevisions(database, post.id)).map(v => v.number)
    assert.deepStrictEqual(numbers, [2, 1])
  })

  it("finds a version only through its own post", async () => {
    const one = await newPost()
    const other = await newPost('x.post')
    await edit(one.id, 'Changed', 'Changed body')
    const [version] = await listRevisions(database, one.id)
    assert.ok(await findRevision(database, one.id, version!.id))
    assert.strictEqual(await findRevision(database, other.id, version!.id), undefined)
  })

  it('is removed with its post', async () => {
    const post = await newPost()
    await edit(post.id, 'Changed', 'Changed body')
    await database.delete(schema.postDraftsTable).where(eq(schema.postDraftsTable.id, post.id))
    assert.strictEqual((await listRevisions(database, post.id)).length, 0)
  })
})
