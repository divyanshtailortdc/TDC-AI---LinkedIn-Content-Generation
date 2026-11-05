import 'server-only'

import { db } from '@/db'
import { intelMentionsTable } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import type { StoryUse } from './status'

/**
 * Sets whether ideas may use one of the workspace's stories (STORY_USES).
 * Excluding it drops its embedding at once, as nothing will read it; keeping
 * an old one gets it embedded again by the next pass (index-stories.ts).
 * False when the workspace has no such story.
 */
export async function setStoryUse(
  accountId: string,
  storyId: string,
  use: StoryUse
): Promise<boolean> {
  const mentions = intelMentionsTable
  const rows = await db
    .update(mentions)
    .set(
      use === 'never'
        ? { useInIdeas: use, embedding: null, embeddingModel: null }
        : { useInIdeas: use }
    )
    .where(and(eq(mentions.id, storyId), eq(mentions.accountId, accountId)))
    .returning({ id: mentions.id })
  return rows.length > 0
}
