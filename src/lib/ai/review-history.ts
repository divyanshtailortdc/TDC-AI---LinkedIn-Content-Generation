import {
  accountsTable,
  feedbackTable,
  ideasTable,
  postDraftsTable
} from '@/db/schema'
import { DEFAULT_FORMAT } from '@/lib/formats'
import type { IdentityDb } from '@/lib/identity-write'
import { and, desc, eq, isNotNull, ne, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { ReviewHistory } from './context-blocks'

/**
 * Made since the identity was last switched to another company
 * (accounts.context_since; src/lib/identity-switch.ts): the posts, ideas and
 * rejections from before belong to the old company, and would steer the new
 * one's ideas towards its subjects. Everything counts when it was never
 * switched.
 */
function sinceSwitch(column: AnyPgColumn, accountId: string): SQL {
  return sql`${column} >= coalesce((select ${accountsTable.contextSince} from ${accountsTable} where ${accountsTable.id} = ${accountId}), '-infinity'::timestamptz)`
}

/**
 * Enough to spot a repeat or a pattern in rejections without bloating prompts.
 * `otherDrafts` covers every non-LinkedIn format together; each format reads
 * its own from it (forFormat).
 */
const HISTORY_LIMITS = { drafts: 30, otherDrafts: 90, ideas: 40, rejectionReasons: 8 }

/** What the reviewer has seen and decided, for prompts; see sinceSwitch. */
export async function loadReviewHistory(
  database: IdentityDb,
  accountId: string
): Promise<ReviewHistory> {
  const draftColumns = {
    hook: postDraftsTable.hook,
    originalHook: postDraftsTable.originalHook,
    body: postDraftsTable.body,
    cta: postDraftsTable.cta,
    status: postDraftsTable.status
  }
  const [drafts, otherDrafts, ideas, feedback] = await Promise.all([
    // LinkedIn posts only, exactly as before other formats existed.
    database
      .select(draftColumns)
      .from(postDraftsTable)
      .where(
        and(
          eq(postDraftsTable.accountId, accountId),
          eq(postDraftsTable.formatId, DEFAULT_FORMAT),
          sinceSwitch(postDraftsTable.createdAt, accountId)
        )
      )
      .orderBy(desc(postDraftsTable.createdAt))
      .limit(HISTORY_LIMITS.drafts),
    database
      .select({ ...draftColumns, formatId: postDraftsTable.formatId })
      .from(postDraftsTable)
      .where(
        and(
          eq(postDraftsTable.accountId, accountId),
          ne(postDraftsTable.formatId, DEFAULT_FORMAT),
          sinceSwitch(postDraftsTable.createdAt, accountId)
        )
      )
      .orderBy(desc(postDraftsTable.createdAt))
      .limit(HISTORY_LIMITS.otherDrafts),
    database
      .select({
        title: ideasTable.title,
        hook: ideasTable.hook,
        hookConcept: ideasTable.hookConcept,
        thesis: ideasTable.thesis,
        coreArgument: ideasTable.coreArgument,
        status: ideasTable.status,
        runId: ideasTable.runId
      })
      .from(ideasTable)
      .where(
        and(
          eq(ideasTable.accountId, accountId),
          sinceSwitch(ideasTable.createdAt, accountId)
        )
      )
      .orderBy(desc(ideasTable.createdAt))
      .limit(HISTORY_LIMITS.ideas),
    database
      .select({ reasonText: feedbackTable.reasonText })
      .from(feedbackTable)
      .where(
        and(
          eq(feedbackTable.accountId, accountId),
          eq(feedbackTable.verdict, 'rejected'),
          isNotNull(feedbackTable.reasonText),
          sinceSwitch(feedbackTable.createdAt, accountId)
        )
      )
      .orderBy(desc(feedbackTable.createdAt))
      .limit(HISTORY_LIMITS.rejectionReasons)
  ])

  return {
    drafts,
    otherDrafts,
    ideas: ideas.map(i => ({
      title: i.title || i.hook,
      hookConcept: i.hookConcept || i.hook,
      thesis: i.thesis || '',
      coreArgument: i.coreArgument || '',
      status: i.status,
      runId: i.runId
    })),
    rejectionReasons: feedback
      .map(f => f.reasonText?.trim() || '')
      .filter(Boolean)
  }
}
