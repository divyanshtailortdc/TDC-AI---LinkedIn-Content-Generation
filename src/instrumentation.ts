export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { env } = await import('~/env')
    const { runsJobTimers } = await import('~/jobs/role')

    if (env.APP_ENV !== 'development') {
      const { logEventLoopDelay } = await import('~/lib/event-loop-delay')
      logEventLoopDelay(env.APP_ROLE)
    }

    if (runsJobTimers()) {
      const { startWorker } = await import('~/jobs/worker')
      const { startScheduler } = await import('~/jobs/scheduler')
      startWorker()
      startScheduler()
    }
  }
}
