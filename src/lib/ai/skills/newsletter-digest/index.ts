import 'server-only'

import type { EmailContent } from '../../../intel/email-content'
import { RetryLaterError } from '../../../intel/settings'
import { isBusyError, runSkill, SkillError } from '../../run-skill'
import { digestHeuristically } from './fallback'
import { keepGroundedDigest } from './guard'
import { buildPrompt, INSTRUCTIONS } from './prompt'
import { DigestSchema, type NewsletterDigest } from './schema'

export type { DigestItem, NewsletterDigest } from './schema'

const DIGEST_TIMEOUT_MS = 90_000

/**
 * Skill: a received email in, what kind it is and the stories it covers out.
 * Without a model, or when its answer is unusable, the links themselves
 * become the stories. A model that is busy (timed out, out of budget,
 * rate-limited, down) is tried again later instead (RetryLaterError), since
 * its digest is much better than the fallback, except on the `lastChance`.
 */
export async function digestEmail(
  email: {
    from: string
    subject: string
    content: EmailContent
  },
  options: { lastChance?: boolean } = {}
): Promise<NewsletterDigest> {
  if (!email.content.text.trim()) {
    return { kind: 'other', summary: '', topics: [], items: [] }
  }
  try {
    const { output } = await runSkill({
      stage: 'extraction',
      instructions: INSTRUCTIONS,
      prompt: buildPrompt({
        from: email.from,
        subject: email.subject,
        text: email.content.text
      }),
      schema: DigestSchema,
      timeoutMs: DIGEST_TIMEOUT_MS,
      maxRetries: 1
    })
    return keepGroundedDigest(output, email.content)
  } catch (err) {
    if (isBusyError(err) && !options.lastChance) {
      throw new RetryLaterError(`The digest model call failed: ${err.message}`)
    }
    if (!(err instanceof SkillError && err.reason === 'not_configured')) {
      console.warn('Newsletter digest failed, using the links instead:', err)
    }
    return digestHeuristically(email.content)
  }
}
