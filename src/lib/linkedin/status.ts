/**
 * States of a LinkedIn publishing connection and of each publication. Shared
 * by the schema (check constraints) and the code, so they cannot drift apart.
 */

/**
 * connected: a token that can publish. expired: LinkedIn refused the token or
 * it ran out; the user must connect again. disconnected: the user removed it;
 * its tokens are gone.
 */
export const CONNECTION_STATUSES = [
  'connected',
  'expired',
  'disconnected'
] as const
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number]

/**
 * scheduled: waiting for its time (or its next retry). publishing: a worker
 * has claimed it and may be talking to LinkedIn. published: LinkedIn returned
 * the post id. failed: will not be tried again by itself. cancelled: the user
 * (or a disconnect) called it off.
 */
export const PUBLICATION_STATUSES = [
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled'
] as const
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number]

/**
 * A post has at most one publication in these states (a partial unique
 * index): one waiting, in flight or done. That index is what makes a double
 * click, two tabs or a second worker unable to publish the same post twice.
 */
export const LIVE_PUBLICATION_STATUSES = [
  'scheduled',
  'publishing',
  'published'
] as const satisfies readonly PublicationStatus[]

export const PUBLICATION_TRIGGERS = ['manual', 'scheduled', 'auto'] as const
export type PublicationTrigger = (typeof PUBLICATION_TRIGGERS)[number]

/**
 * Why a publication failed, for the UI. `unknown_outcome` is the important
 * one: the request may have reached LinkedIn, so it is never retried by
 * itself, and the user is asked to check their profile first.
 */
export type PublicationErrorCode =
  | 'not_connected'
  | 'reauth_required'
  | 'missing_permission'
  | 'not_approved'
  | 'already_posted'
  | 'too_long'
  | 'rate_limited'
  | 'linkedin_unavailable'
  | 'rejected_by_linkedin'
  | 'unknown_outcome'
  | 'internal'
