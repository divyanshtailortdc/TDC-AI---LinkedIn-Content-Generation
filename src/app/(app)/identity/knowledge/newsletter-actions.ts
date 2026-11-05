'use server'

import { requireIdentityId } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import { KNOWLEDGE_PATH } from '@/lib/knowledge-path'
import { requireUser } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import { STORY_USES, type StoryUse } from '~/lib/intel/status'
import { setStoryUse } from '~/lib/intel/story-use'

/**
 * "Keep" or "Don't use" on a newsletter story, or back to automatic. Only
 * the user's own identity's stories.
 */
export async function changeStoryUse(storyId: string, use: StoryUse) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const valid = isUuid(storyId) && STORY_USES.includes(use)
    if (!valid || !(await setStoryUse(accountId, storyId, use))) {
      return { success: false as const, error: 'Story not found.' }
    }
    revalidatePath(KNOWLEDGE_PATH)
    return { success: true as const }
  } catch (err) {
    console.error('Changing whether ideas use a story failed:', err)
    return { success: false as const, error: 'Could not change it.' }
  }
}
