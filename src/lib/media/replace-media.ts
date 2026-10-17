import { postMediaTable } from '@/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

type MediaDb = PgDatabase<PostgresJsQueryResultHKT, any, any>

/**
 * Makes an image the reviewer supplied the post's active media, as a new
 * version. The current image is set aside and earlier versions are left as they
 * were. The new row carries none of the old image's labels (relevance, brief,
 * size): it was not generated or scored by the pipeline.
 */
export async function replaceActiveMedia(
  database: MediaDb,
  input: {
    draftId: string
    mode: 'ai_generated' | 'stock'
    imageUrl: string
    altText?: string | null
    promptOrQuery?: string | null
    /** Stored in the metadata, so the screen knows who chose the image. */
    source: string
  }
) {
  return database.transaction(async tx => {
    const latest = (status?: string) =>
      tx
        .select()
        .from(postMediaTable)
        .where(
          and(
            eq(postMediaTable.draftId, input.draftId),
            status ? eq(postMediaTable.status, status) : undefined
          )
        )
        .orderBy(desc(postMediaTable.createdAt))
        .limit(1)
    const current = (await latest('active'))[0] ?? (await latest())[0]

    if (current) {
      await tx
        .update(postMediaTable)
        .set({
          status: 'superseded',
          rejectionReason: 'Replaced by an image the reviewer supplied',
          updatedAt: new Date()
        })
        .where(eq(postMediaTable.id, current.id))
    }

    const [inserted] = await tx
      .insert(postMediaTable)
      .values({
        draftId: input.draftId,
        version: (current?.version || 0) + 1,
        status: 'active',
        previousMediaId: current?.id || null,
        regenerationAttempt: current?.regenerationAttempt || 0,
        mode: input.mode,
        imageUrl: input.imageUrl,
        altText: input.altText || null,
        promptOrQuery: input.promptOrQuery || null,
        metadata: { source: input.source, fallbackApplied: false }
      })
      .returning()
    if (!inserted) throw new Error('Failed to save the image')
    return inserted
  })
}
