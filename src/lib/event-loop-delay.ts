import { monitorEventLoopDelay } from 'node:perf_hooks'

declare global {
  var __eventLoopDelayLog: NodeJS.Timeout | undefined
}

const RESOLUTION_MS = 10
const REPORT_EVERY_MS = 60_000

/**
 * Logs, once a minute, how late the event loop ran its callbacks. Synchronous
 * work (rendering an image, parsing a page) makes every request in the process
 * wait that long. One JSON line, so Cloud Logging can filter on it, e.g.
 * `jsonPayload.message="Event loop delay" AND jsonPayload.p99Ms>100`.
 */
export function logEventLoopDelay(role: string) {
  if (globalThis.__eventLoopDelayLog) return

  const histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS })
  histogram.enable()
  // Each sample includes the sampling interval itself; an idle loop reads 0.
  const lateMs = (ns: number) =>
    Math.max(0, Math.round(ns / 1e6 - RESOLUTION_MS))

  globalThis.__eventLoopDelayLog = setInterval(() => {
    console.log(
      JSON.stringify({
        message: 'Event loop delay',
        role,
        p50Ms: lateMs(histogram.percentile(50)),
        p99Ms: lateMs(histogram.percentile(99)),
        maxMs: lateMs(histogram.max)
      })
    )
    histogram.reset()
  }, REPORT_EVERY_MS)
  globalThis.__eventLoopDelayLog.unref()
}
