/**
 * The message a route returns for a failure it did not expect. Messages the
 * app writes for the user (an image the safety filter blocked, a spending
 * limit) pass through; anything about the server's own workings does not:
 * a database error's text holds the query and its parameters (drizzle's
 * "Failed query: <sql>\nparams: <values>"), a storage error names buckets and
 * keys, and a TypeError describes the code. Those are logged, and the user
 * gets `fallback`.
 */
export function publicErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error) || !err.message.trim()) return fallback
  return isInternal(err) ? fallback : err.message
}

function isInternal(err: Error, depth = 0): boolean {
  if (
    err.name === 'DrizzleQueryError' ||
    err.name === 'PostgresError' ||
    /^Failed query:/i.test(err.message)
  ) {
    return true
  }
  if (
    err instanceof TypeError ||
    err instanceof ReferenceError ||
    err instanceof SyntaxError ||
    err instanceof RangeError
  ) {
    return true
  }
  // AWS SDK errors (object storage) carry the request's metadata.
  if ('$metadata' in err) return true
  const cause = (err as { cause?: unknown }).cause
  return depth < 3 && cause instanceof Error && isInternal(cause, depth + 1)
}
