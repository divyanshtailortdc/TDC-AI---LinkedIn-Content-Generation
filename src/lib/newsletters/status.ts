/**
 * Where a discovered newsletter stands for the identity. Client-safe: no
 * imports, so the schema, the actions and the page all read the same list.
 *
 * Subscribing happens on the publisher's own page, by the user. The app only
 * records what the user tells it, so no status here means "we signed you up":
 * - discovered: found by discovery, untouched since.
 * - saved: kept by the user for later.
 * - pending_confirmation: the user submitted the form and is waiting for the
 *   publisher's confirmation email.
 * - subscribed: the user says they are on the list.
 * - active: issues are known to be arriving. Nothing sets this yet; it is
 *   for the inbox step that reads them. Opening the signup page never does.
 * - unsubscribed: the user left the list.
 * - failed: the user could not sign up (form broken, list closed, paywall).
 */
export const NEWSLETTER_STATUSES = [
  'discovered',
  'saved',
  'pending_confirmation',
  'subscribed',
  'active',
  'unsubscribed',
  'failed'
] as const

export type NewsletterStatus = (typeof NEWSLETTER_STATUSES)[number]

export const NEWSLETTER_STATUS_LABELS: Record<NewsletterStatus, string> = {
  discovered: 'Discovered',
  saved: 'Saved',
  pending_confirmation: 'Awaiting confirmation',
  subscribed: 'Subscribed',
  active: 'Active',
  unsubscribed: 'Unsubscribed',
  failed: 'Signup failed'
}

/** What the user can do to a newsletter from the page. */
export const NEWSLETTER_ACTIONS = [
  'save',
  'unsave',
  'mark_pending',
  'mark_subscribed',
  'mark_unsubscribed',
  'mark_failed'
] as const

export type NewsletterAction = (typeof NEWSLETTER_ACTIONS)[number]

/** Each action, the statuses it may start from, and where it leads. */
const TRANSITIONS: Record<
  NewsletterAction,
  { from: readonly NewsletterStatus[]; to: NewsletterStatus }
> = {
  save: { from: ['discovered'], to: 'saved' },
  unsave: { from: ['saved'], to: 'discovered' },
  mark_pending: {
    from: ['discovered', 'saved', 'failed', 'unsubscribed'],
    to: 'pending_confirmation'
  },
  mark_subscribed: {
    from: [
      'discovered',
      'saved',
      'pending_confirmation',
      'failed',
      'unsubscribed'
    ],
    to: 'subscribed'
  },
  mark_unsubscribed: {
    from: ['pending_confirmation', 'subscribed', 'active'],
    to: 'unsubscribed'
  },
  mark_failed: {
    from: ['discovered', 'saved', 'pending_confirmation'],
    to: 'failed'
  }
}

/** The status `action` leads to from `current`, or null when it does not apply. */
export function nextNewsletterStatus(
  current: NewsletterStatus,
  action: NewsletterAction
): NewsletterStatus | null {
  const transition = TRANSITIONS[action]
  return transition.from.includes(current) ? transition.to : null
}

/** Where `action` leads. */
export function statusAfter(action: NewsletterAction): NewsletterStatus {
  return TRANSITIONS[action].to
}

/** The statuses `action` may start from, for a guarded UPDATE. */
export function statusesAllowing(
  action: NewsletterAction
): readonly NewsletterStatus[] {
  return TRANSITIONS[action].from
}

/** The kinds of newsletter discovery looks for. */
export const NEWSLETTER_CATEGORIES = [
  'industry',
  'niche',
  'business',
  'technology'
] as const

export type NewsletterCategory = (typeof NEWSLETTER_CATEGORIES)[number]

export const NEWSLETTER_CATEGORY_LABELS: Record<NewsletterCategory, string> = {
  industry: 'Industry',
  niche: 'Niche',
  business: 'Business publication',
  technology: 'Technology'
}
