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
  (row.metadata ?? {}) as {
    issues?: unknown
    factIssues?: unknown
    look?: unknown
  }

/**
 * How a slide made like the account's own posts was designed (SlideDesign
 * .look), kept so it can be made again alone: the carousel's style, which
 * examples it followed, and what this slide shows beside its words.
 */
export interface SlideLook {
  kind: 'photo' | 'graphic'
  styleNotes: string
  /** The examples followed, 1-based, as loadLookExamples lists them. */
  examples: number[]
  logoCorner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'none'
  /** The account's name is set on the slide as its wordmark. */
  wordmark: boolean
  scene: string
  concept: string
}

const LOOK_CORNER_VALUES = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'none'
] as const

/** The stored design of a slide made like the account's posts; null for a drawn one. */
export function slideLookOf(row: Pick<PostSlide, 'metadata'>): SlideLook | null {
  const raw = metadataOf(row).look
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const look = raw as Record<string, unknown>
  if (typeof look.styleNotes !== 'string' || !look.styleNotes.trim()) return null
  return {
    kind: look.kind === 'photo' ? 'photo' : 'graphic',
    styleNotes: look.styleNotes,
    examples: Array.isArray(look.examples)
      ? look.examples.filter(
          (n): n is number => Number.isInteger(n) && (n as number) >= 1
        )
      : [],
    logoCorner: (LOOK_CORNER_VALUES as readonly unknown[]).includes(
      look.logoCorner
    )
      ? (look.logoCorner as SlideLook['logoCorner'])
      : 'none',
    wordmark: look.wordmark === true,
    scene: typeof look.scene === 'string' ? look.scene : '',
    concept: typeof look.concept === 'string' ? look.concept : ''
  }
}

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((i): i is string => typeof i === 'string')
    : []

/** What the review screen says about a slide's picture. */
export function slideIssues(row: Pick<PostSlide, 'metadata'>): string[] {
  return strings(metadataOf(row).issues)
}

/**
 * What the slide's words state that no source does (slideFactIssues), as of
 * when they were last written. Kept apart from the picture's issues, as each
 * changes on its own.
 */
export function slideFactIssuesOf(row: Pick<PostSlide, 'metadata'>): string[] {
  return strings(metadataOf(row).factIssues)
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
    /** See slideFactIssuesOf. */
    factIssues?: string[]
    picturePrompt?: string
    /** A slide made like the account's posts: how it was designed. */
    look?: SlideLook
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
      ...(stored.factIssues?.length ? { factIssues: stored.factIssues } : {}),
      ...(stored.picturePrompt ? { picturePrompt: stored.picturePrompt } : {}),
      ...(stored.look ? { look: stored.look } : {})
    }
  }
}
