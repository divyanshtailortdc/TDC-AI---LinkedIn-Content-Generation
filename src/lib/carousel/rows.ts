import { postSlidesTable, type NewPostSlide, type PostSlide } from '@/db/schema'
import { asc, eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import {
  cleanDesign,
  isSlideRole,
  type SlideContent,
  type SlideRenderStatus
} from './types'

/**
 * A carousel's slide rows, read and written against a database passed in, so
 * publishing (and its tests) can read them on any connection. No
 * `server-only` import.
 */

type SlidesDb = PgDatabase<PostgresJsQueryResultHKT, any, any>

/** A post's slides, in swipe order. */
export function loadSlideRows(
  database: SlidesDb,
  draftId: string
): Promise<PostSlide[]> {
  return database
    .select()
    .from(postSlidesTable)
    .where(eq(postSlidesTable.draftId, draftId))
    .orderBy(asc(postSlidesTable.position), asc(postSlidesTable.createdAt))
}

/** A stored slide's words and design, as the writer and renderer use them. */
export function slideContentOf(row: PostSlide): SlideContent {
  const role = isSlideRole(row.role) ? row.role : 'content'
  return {
    role,
    headline: row.headline,
    body: row.body,
    imagePrompt: row.imagePrompt,
    design: cleanDesign(role, row.design),
    altText: row.altText ?? ''
  }
}

const metadataOf = (row: Pick<PostSlide, 'metadata'>) =>
  (row.metadata ?? {}) as { issues?: unknown }

/** What the review screen says about a slide's picture. */
export function slideIssues(row: Pick<PostSlide, 'metadata'>): string[] {
  const issues = metadataOf(row).issues
  return Array.isArray(issues)
    ? issues.filter((i): i is string => typeof i === 'string')
    : []
}

/** A slide's row, ready to insert or update, from what was drawn and stored. */
export function slideRowValues(
  draftId: string,
  position: number,
  slide: SlideContent,
  stored: {
    imageUrl: string | null
    pictureUrl: string | null
    error: string | null
    issues: string[]
    picturePrompt?: string
  }
): NewPostSlide {
  const status: SlideRenderStatus = stored.imageUrl ? 'ready' : 'failed'
  return {
    draftId,
    position,
    role: slide.role,
    headline: slide.headline,
    body: slide.body,
    imagePrompt: slide.imagePrompt,
    design: { ...slide.design },
    altText: slide.altText || null,
    imageUrl: stored.imageUrl,
    pictureUrl: stored.pictureUrl,
    renderStatus: status,
    renderError: stored.imageUrl
      ? null
      : (stored.error ?? 'The slide could not be drawn.'),
    metadata: {
      issues: stored.issues,
      ...(stored.picturePrompt ? { picturePrompt: stored.picturePrompt } : {})
    }
  }
}
