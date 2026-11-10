import { postDraftsTable, postRevisionsTable, type PostDraft } from '@/db/schema'
import { and, desc, eq, max } from 'drizzle-orm'
import type { DraftingDb } from '~/lib/ai/pipeline/drafting-claim'

/**
 * Earlier versions of a post. Every change that overwrites a post's text (an
 * edit, a regenerate, a restore) first saves the text it replaces, inside the
 * same transaction, so nothing written by the model or the reviewer is lost
 * and a restore is itself undoable.
 */

export type ReplacedBy = 'user_edit' | 'regenerate' | 'restore'

/** The text columns a version keeps. */
type VersionText = Pick<
  PostDraft,
  'hook' | 'body' | 'cta' | 'firstComment' | 'hashtags' | 'payload' | 'charCount'
>

const sameText = (a: VersionText, b: Partial<VersionText>) =>
  a.hook === (b.hook ?? a.hook) &&
  a.body === (b.body ?? a.body) &&
  (a.cta ?? '') === (b.cta === undefined ? (a.cta ?? '') : (b.cta ?? '')) &&
  (a.firstComment ?? '') ===
    (b.firstComment === undefined ? (a.firstComment ?? '') : (b.firstComment ?? '')) &&
  (b.payload === undefined ||
    JSON.stringify(a.payload ?? null) === JSON.stringify(b.payload ?? null))

/**
 * Locks the post's row for the rest of the transaction and returns it, so two
 * changes to one post are applied one after the other.
 */
export async function lockPost(
  tx: DraftingDb,
  draftId: string
): Promise<PostDraft | undefined> {
  const [row] = await tx
    .select()
    .from(postDraftsTable)
    .where(eq(postDraftsTable.id, draftId))
    .for('update')
  return row
}

/**
 * Saves `current` (the post as it stands, from lockPost) as its next earlier
 * version, unless `next` leaves its text as it is. True when it saved one.
 */
export async function saveRevision(
  tx: DraftingDb,
  current: PostDraft,
  replacedBy: ReplacedBy,
  options: { instruction?: string | null; next?: Partial<VersionText> } = {}
): Promise<boolean> {
  if (options.next && sameText(current, options.next)) return false
  const [last] = await tx
    .select({ number: max(postRevisionsTable.number) })
    .from(postRevisionsTable)
    .where(eq(postRevisionsTable.draftId, current.id))
  await tx.insert(postRevisionsTable).values({
    draftId: current.id,
    number: (last?.number ?? 0) + 1,
    replacedBy,
    instruction: options.instruction ?? null,
    hook: current.hook,
    body: current.body,
    cta: current.cta,
    firstComment: current.firstComment,
    hashtags: current.hashtags ?? [],
    payload: current.payload ?? null,
    charCount: current.charCount
  })
  return true
}

/** A post's earlier versions, newest first. */
export async function listRevisions(database: DraftingDb, draftId: string) {
  return database
    .select()
    .from(postRevisionsTable)
    .where(eq(postRevisionsTable.draftId, draftId))
    .orderBy(desc(postRevisionsTable.number))
    .limit(50)
}

export async function findRevision(
  database: DraftingDb,
  draftId: string,
  revisionId: string
) {
  const [row] = await database
    .select()
    .from(postRevisionsTable)
    .where(
      and(
        eq(postRevisionsTable.id, revisionId),
        eq(postRevisionsTable.draftId, draftId)
      )
    )
  return row
}
