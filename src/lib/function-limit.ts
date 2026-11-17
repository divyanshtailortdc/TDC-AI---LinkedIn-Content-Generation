/**
 * Seconds Vercel lets a function run, the work it holds open with `after()`
 * included: the Hobby plan's most. It ends the function there and runs no
 * cleanup, so work that may take longer has its own deadline below this.
 *
 * Route segment config must be a literal, so the (app) layout and
 * /api/cron/jobs repeat it as `maxDuration = 300`; change them together.
 */
export const FUNCTION_MAX_DURATION_S = 300

/** Whether this process is a Vercel function, with its time limit. `VERCEL` is set by Vercel. */
export const onVercel = () => Boolean(process.env.VERCEL)
