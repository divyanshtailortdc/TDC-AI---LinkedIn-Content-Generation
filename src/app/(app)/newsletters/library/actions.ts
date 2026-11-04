'use server'

import { requireIdentityId } from '@/lib/identity'
import { IDENTITY_PATH } from '@/lib/identity-path'
import { isUuid } from '@/lib/ids'
import { LIBRARY_PATH } from '@/lib/library-path'
import { requireUser } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import { saveStoryToKnowledge } from '~/lib/intel/save-to-knowledge'

/**
 * "Save to Knowledge base" on a story: its article becomes one of the
 * identity's knowledge documents. Only the user's own identity's stories.
 */
export async function saveToKnowledge(storyId: string) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const error = isUuid(storyId)
      ? await saveStoryToKnowledge(accountId, storyId)
      : 'Story not found.'
    if (error) return { success: false as const, error }
    revalidatePath(LIBRARY_PATH)
    revalidatePath(`${IDENTITY_PATH}/knowledge`)
    return { success: true as const }
  } catch (err) {
    console.error('Saving a story to the knowledge base failed:', err)
    return {
      success: false as const,
      error: 'Could not save it to the knowledge base.'
    }
  }
}
