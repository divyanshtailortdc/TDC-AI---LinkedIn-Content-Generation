import { syncInbox } from '~/lib/mail/sync'

declare global {
  var __inboxSyncRunning: boolean | undefined
}

/**
 * One inbox sync pass, if one is due: the scheduler's tick, /api/cron/jobs
 * and "Refresh" all call this. A call while this process already runs a pass
 * returns at once (the sync lease does the same across processes); a Refresh
 * made meanwhile stays recorded and gets the next pass.
 */
export async function runInboxSync() {
  if (globalThis.__inboxSyncRunning) return
  globalThis.__inboxSyncRunning = true
  try {
    const result = await syncInbox()
    if (
      result.status === 'synced' &&
      (result.stored > 0 || result.unrouted > 0)
    ) {
      console.info(
        `Inbox sync: stored ${result.stored} email(s), skipped ${result.unrouted} for unknown addresses${result.backlog ? ' (more waiting)' : ''}.`
      )
    }
  } catch (err) {
    console.error('Inbox sync crashed:', err)
  } finally {
    globalThis.__inboxSyncRunning = false
  }
}
