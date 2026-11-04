import { runExtractionPass } from '~/lib/intel/pass'

declare global {
  var __mailExtractionRunning: boolean | undefined
}

/**
 * One extraction pass over received email (src/lib/intel/pass.ts): the
 * scheduler's tick, /api/cron/jobs and "Refresh" call this after the inbox
 * sync. A call while this process already runs a pass returns at once; other
 * processes are kept apart by the claims on each email and article.
 */
export async function runMailExtraction() {
  if (globalThis.__mailExtractionRunning) return
  globalThis.__mailExtractionRunning = true
  try {
    const { emails, articles, stories } = await runExtractionPass()
    if (emails > 0 || articles > 0 || stories > 0) {
      console.info(
        `Mail extraction: ${emails} email(s), ${articles} article(s) and ${stories} story embedding(s) processed.`
      )
    }
  } catch (err) {
    console.error('Mail extraction crashed:', err)
  } finally {
    globalThis.__mailExtractionRunning = false
  }
}
