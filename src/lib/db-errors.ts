/**
 * Postgres unique_violation (23505), whether thrown by the driver or wrapped
 * by drizzle (DrizzleQueryError keeps the driver's error as `cause`).
 */
export const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } } | undefined
  return e?.code === '23505' || e?.cause?.code === '23505'
}
