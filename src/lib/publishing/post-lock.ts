import 'server-only'

import { db } from '@/db'
import { isPublishingConfigured } from './config'
import type { PublishingDb } from './connection'
import { hasLivePublication } from './publication-queries'

/** A change refused because the post already went out. */
export class PostLockedError extends Error {}

/**
 * Refuses a change to a post that is marked as posted, or published (or being
 * published) on its platform: its text and image stay as they went out. The
 * carousel's slides (assertEditable), its media type (setPostMediaFormat) and
 * a rewrite or restore (drafting-run) follow the same rule. `database` may be
 * a transaction holding the post's lock.
 */
export async function assertPostChangeable(
  draft: { id: string; postedAt: Date | string | null },
  database: PublishingDb = db
): Promise<void> {
  if (draft.postedAt) {
    throw new PostLockedError(
      'This post is marked as posted, so it can no longer change.'
    )
  }
  if (isPublishingConfigured() && (await hasLivePublication(database, draft.id))) {
    throw new PostLockedError(
      'This post is published on its platform, so it can no longer change.'
    )
  }
}
