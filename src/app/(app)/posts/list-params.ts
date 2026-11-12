/**
 * The posts list's URL params (/posts?platform=x&status=approved…). A post's
 * page carries them along, so its "All posts" link goes back to the list as
 * it was left.
 */
export const LIST_PARAMS = [
  'platform',
  'status',
  'hidden',
  'from',
  'to',
  'sort',
  'q',
  'page',
  'view',
  'runId'
] as const
