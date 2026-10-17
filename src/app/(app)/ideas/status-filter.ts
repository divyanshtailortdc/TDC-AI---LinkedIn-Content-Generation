/** The Ideas page's status filter, in the order its menu lists them. */
export const STATUS_TABS = ['proposed', 'approved', 'rejected', 'all'] as const
export type StatusFilter = (typeof STATUS_TABS)[number]

/** The status filter lives in the URL (?status=) so it survives a reload and can be shared. */
export function parseStatusFilter(
  value: string | string[] | undefined
): StatusFilter {
  const status = Array.isArray(value) ? value[0] : value
  return STATUS_TABS.find(tab => tab === status) ?? 'all'
}

/**
 * How many ideas each filter shows, from per-status counts. Ideas being
 * drafted or already drafted count only toward "all".
 */
export function statusFilterCounts(
  rows: { status: string; n: number }[]
): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = {
    proposed: 0,
    approved: 0,
    rejected: 0,
    all: 0
  }
  for (const { status, n } of rows) {
    counts.all += n
    const tab = STATUS_TABS.find(t => t !== 'all' && t === status)
    if (tab) counts[tab] += n
  }
  return counts
}
