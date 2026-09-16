/**
 * Client-safe relevance presentation.
 *
 * Kept separate from `./brief` deliberately: that module imports the AI client,
 * which reads server-only environment variables at module scope. The review UI
 * is a client component, so importing this helper from there must not drag the
 * server graph along with it.
 */

export type UserFacingRelevanceLevel =
  | 'Highly relevant'
  | 'Relevant'
  | 'Weak match'
  | 'Not relevant'

export interface UserFacingRelevanceInfo {
  level: UserFacingRelevanceLevel
  label: string
  badgeVariant: 'success' | 'info' | 'warning' | 'destructive'
  isPass: boolean
  warningMessage?: string
}

export function getUserFacingRelevance(
  validation?: {
    relevanceScore?: number
    issues?: string[]
  } | null
): UserFacingRelevanceInfo {
  if (!validation) {
    return {
      level: 'Weak match',
      label: 'Weak match',
      badgeVariant: 'warning',
      isPass: false,
      warningMessage: 'This image has not been checked against the post.'
    }
  }

  const score = validation.relevanceScore ?? 0
  const issues = validation.issues || []

  if (issues.length > 0 || score < 50) {
    return {
      level: 'Not relevant',
      label: 'Not relevant',
      badgeVariant: 'destructive',
      isPass: false,
      warningMessage:
        issues[0] || 'This image does not reflect what the post argues.'
    }
  }
  if (score >= 85) {
    return {
      level: 'Highly relevant',
      label: 'Highly relevant',
      badgeVariant: 'success',
      isPass: true
    }
  }
  if (score >= 65) {
    return {
      level: 'Relevant',
      label: 'Relevant',
      badgeVariant: 'info',
      isPass: true
    }
  }
  return {
    level: 'Weak match',
    label: 'Weak match',
    badgeVariant: 'warning',
    isPass: false,
    warningMessage: 'This image is only loosely related to the post.'
  }
}
