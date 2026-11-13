import 'server-only'

import { db } from '@/db'
import {
  ideasTable,
  postCitationsTable,
  postMediaTable,
  type PostDraft
} from '@/db/schema'
import {
  DEFAULT_FORMAT,
  formatCharCount,
  formatOf,
  resolveMediaFormat
} from '@/lib/formats'
import { postCharCount } from '@/lib/post-text'
import { and, count, eq, isNotNull } from 'drizzle-orm'
import { runLinter, type LintFinding } from '~/lib/lint/run-linter'
import { loadGenerationContext, loadIdeaContext } from '../context'
import { buildFormatLintOptions } from './post-lint'

/**
 * The character count and quality checks for a post's text as it now stands,
 * by its own platform's rules: after an edit, or when an earlier version is
 * restored. Left as they were, they kept judging the version the AI wrote.
 * When the checks cannot run, the post's earlier findings are returned.
 */
export async function recheckPostText(
  existing: Pick<
    PostDraft,
    'id' | 'accountId' | 'ideaId' | 'formatId' | 'platform' | 'lintFindings'
  > &
    Partial<Pick<PostDraft, 'mediaFormat'>>,
  text: {
    hook: string
    body: string
    cta: string | null
    firstComment: string | null
    hashtags: string[] | null
    payload?: Record<string, unknown> | null
  }
): Promise<{ charCount: number; lintFindings: LintFinding[] }> {
  const formatId = formatOf(existing.formatId)
  const charCount =
    formatId === DEFAULT_FORMAT
      ? postCharCount(text)
      : formatCharCount(formatId, text)

  let lintFindings = (existing.lintFindings ?? []) as LintFinding[]
  try {
    const idea = existing.ideaId
      ? await db.query.ideasTable.findFirst({
          where: eq(ideasTable.id, existing.ideaId)
        })
      : null
    // Checked against the post's own goal, as when it was drafted. Only
    // what the checks read is loaded: a save is not a generation.
    const ctx = idea
      ? await loadIdeaContext(idea, {
          lintOnly: true,
          platform: existing.platform
        })
      : await loadGenerationContext(existing.accountId, {
          goalIds: [],
          lintOnly: true,
          platform: existing.platform
        })
    const citations = idea
      ? (idea.supportingEvidence?.length ?? 0)
      : ((
          await db
            .select({ total: count() })
            .from(postCitationsTable)
            .where(eq(postCitationsTable.draftId, existing.id))
        )[0]?.total ?? 0)
    // Wording about slides is judged by what goes out with the text now.
    const [image] = await db
      .select({ id: postMediaTable.id })
      .from(postMediaTable)
      .where(
        and(
          eq(postMediaTable.draftId, existing.id),
          eq(postMediaTable.status, 'active'),
          isNotNull(postMediaTable.imageUrl)
        )
      )
      .limit(1)
    lintFindings = runLinter({
      ...buildFormatLintOptions(ctx, formatId, idea ?? null, text, citations),
      mediaFormat: resolveMediaFormat(formatId, existing.mediaFormat, { image: Boolean(image) })
    })
  } catch (err) {
    // The text is still saved; the earlier checks are kept rather than lost.
    console.error(`Could not re-run the quality checks on draft ${existing.id}:`, err)
  }
  return { charCount, lintFindings }
}
