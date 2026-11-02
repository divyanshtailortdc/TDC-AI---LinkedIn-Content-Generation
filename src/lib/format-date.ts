const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

/**
 * Dates are formatted by hand rather than through `toLocaleString`, which
 * renders with Node's locale on the server and the browser's locale on the
 * client ("9/16/2026" vs "16/09/2026") and breaks hydration.
 *
 * Both read the local clock of whichever side runs them, and the server's time
 * zone is not the viewer's. Call them only once mounted (useHasMounted), or
 * for text the server does not render.
 */

/** "16 Sep", with the year when it is not this one. */
export function formatAbsoluteDate(value: Date | string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.getDate()
  const month = MONTHS[date.getMonth()]
  const year = date.getFullYear()
  return year === new Date().getFullYear()
    ? `${day} ${month}`
    : `${day} ${month} ${year}`
}

/** "16 Sep 2026, 09:05". */
export function formatAbsoluteDateTime(value: Date | string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}`
}

/** Short, scannable timestamp for a dense list: "5m ago", "yesterday". Depends on "now". */
export function formatRelativeDate(value: Date | string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`

  return formatAbsoluteDate(date)
}
