/**
 * One-off: moves post images still held as base64 data URLs in
 * `post_media.image_url` / `base_image_url` into the storage bucket, leaving
 * the storage:// key in their place (see src/lib/media/image-store.ts).
 *
 * A dry run by default: prints the database and bucket it would use and how
 * much is still inline. Pass --apply to move the images. Safe to run again:
 * only rows that still hold a data URL are read, and a row whose upload fails
 * is left as it was.
 *
 * Reads DATABASE_URL and the same STORAGE_* variables as the app:
 *
 *   npx tsx --env-file=.env.production scripts/move-media-images-to-storage.ts
 *   npx tsx --env-file=.env.production scripts/move-media-images-to-storage.ts --apply
 */
import { and, asc, eq, gt, like, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { postMediaTable } from '../src/db/schema'
import { storeImage } from '../src/lib/media/image-store'

// About 1 MB per row (the image and its copy before the logo), so a batch
// holds about 20 MB in memory.
const BATCH = 20
const NO_ID = '00000000-0000-0000-0000-000000000000'

const apply = process.argv.includes('--apply')
const databaseUrl = process.env.DATABASE_URL
const bucket = process.env.STORAGE_BUCKET
if (!databaseUrl) throw new Error('Set DATABASE_URL to the database to move.')
if (!bucket) throw new Error('Set STORAGE_BUCKET to the bucket to move into.')

const client = postgres(databaseUrl, { max: 1, prepare: false })
const db = drizzle(client)

const inline = or(
  like(postMediaTable.imageUrl, 'data:%'),
  like(postMediaTable.baseImageUrl, 'data:%')
)
const isInline = (value: string | null) => Boolean(value?.startsWith('data:'))

async function main() {
  const target = new URL(databaseUrl!)
  console.log(
    `Database: ${target.host || process.env.PGHOST || '(socket)'}${target.pathname}`
  )
  console.log(
    `Bucket:   ${bucket} at ${process.env.STORAGE_ENDPOINT || 'AWS S3'}`
  )

  const [summary] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      megabytes: sql<number>`(coalesce(sum(coalesce(octet_length(${postMediaTable.imageUrl}), 0) + coalesce(octet_length(${postMediaTable.baseImageUrl}), 0)), 0) / 1048576.0)::float8`
    })
    .from(postMediaTable)
    .where(inline)
  console.log(
    `Inline:   ${summary?.rows ?? 0} rows, ${(summary?.megabytes ?? 0).toFixed(1)} MB`
  )

  if (!apply) {
    console.log('Dry run. Pass --apply to move these images.')
    return
  }

  let lastId = NO_ID
  let moved = 0
  let failed = 0
  for (;;) {
    const rows = await db
      .select({
        id: postMediaTable.id,
        draftId: postMediaTable.draftId,
        imageUrl: postMediaTable.imageUrl,
        baseImageUrl: postMediaTable.baseImageUrl
      })
      .from(postMediaTable)
      .where(and(inline, gt(postMediaTable.id, lastId)))
      .orderBy(asc(postMediaTable.id))
      .limit(BATCH)
    if (rows.length === 0) break

    for (const row of rows) {
      const imageUrl = await storeImage(row.imageUrl, row.draftId)
      const baseImageUrl = await storeImage(row.baseImageUrl, row.draftId)
      // storeImage keeps the data URL when an upload fails.
      if (isInline(imageUrl) || isInline(baseImageUrl)) {
        failed++
        continue
      }
      // updated_at is left alone: the image is the same, only where it lives.
      await db
        .update(postMediaTable)
        .set({ imageUrl, baseImageUrl })
        .where(eq(postMediaTable.id, row.id))
      moved++
    }
    lastId = rows[rows.length - 1]!.id
    console.log(`Moved ${moved}, failed ${failed}`)
  }

  console.log(
    `Done. Moved ${moved} rows; ${failed} failed and were left inline.`
  )
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => client.end())
