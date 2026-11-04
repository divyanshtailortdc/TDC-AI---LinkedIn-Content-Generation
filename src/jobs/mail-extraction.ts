import { runExtractionPass } from '~/lib/intel/pass'
import { TIDY_SETTINGS, tidyIntelStorage } from '~/lib/intel/tidy'

declare global {
  var __mailExtractionRunning: boolean | undefined
  var __intelTidiedAt: number | undefined
}

/**
 * One extraction pass over received email (src/lib/intel/pass.ts): the
 * scheduler's tick, /api/cron/jobs and "Refresh" call this after the inbox
 * sync. A call while this process already runs a pass returns at once; other
 * processes are kept apart by the claims on each email and article. Once a
 * day it also drops what nothing uses any more (src/lib/intel/tidy.ts).
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
    await tidyOncePerDay()
  } catch (err) {
    console.error('Mail extraction crashed:', err)
  } finally {
    globalThis.__mailExtractionRunning = false
  }
}

/** Storage upkeep, at most once a day in this process; a failure waits for the next day. */
async function tidyOncePerDay() {
  const last = globalThis.__intelTidiedAt ?? 0
  if (Date.now() - last < TIDY_SETTINGS.everyMs) return
  globalThis.__intelTidiedAt = Date.now()
  try {
    const { embeddings, articles } = await tidyIntelStorage()
    if (embeddings > 0 || articles > 0) {
      console.info(
        `Storage upkeep: ${embeddings} unused story embedding(s) dropped, ${articles} unused article(s) deleted.`
      )
    }
  } catch (err) {
    console.error('Storage upkeep failed:', err)
  }
}
