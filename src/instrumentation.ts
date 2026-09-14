export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWorker } = await import('~/jobs/worker')
    const { startScheduler } = await import('~/jobs/scheduler')
    startWorker()
    startScheduler()
  }
}
