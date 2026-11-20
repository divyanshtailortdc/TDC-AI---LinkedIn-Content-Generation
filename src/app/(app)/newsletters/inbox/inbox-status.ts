import type { Tone } from '@/components/ui/tone'
import { INBOX_PATH } from '@/lib/inbox-path'
import type { DigestKind, ExtractionStatus } from '~/lib/intel/status'

/**
 * The inbox list's filters (?status=), kept beside its search (?q=) and page.
 * Client-safe, so the page, its query and the chips read the same list.
 * - newsletters: emails extraction found to be newsletters.
 * - processing: waiting to be read, or being read.
 * - failed: extraction gave up; the reading pane has Try again.
 */
export const INBOX_FILTERS = ['newsletters', 'processing', 'failed'] as const

export type InboxFilter = (typeof INBOX_FILTERS)[number]

/** ?status= as a filter, or null for all emails. */
export function parseInboxFilter(
  value: string | string[] | undefined
): InboxFilter | null {
  const raw = Array.isArray(value) ? value[0] : value
  return INBOX_FILTERS.find(filter => filter === raw) ?? null
}

/** The inbox's first page with a search and a filter; empty ones are left out. */
export function inboxHref({
  q,
  status
}: {
  q: string
  status: InboxFilter | null
}) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (status) params.set('status', status)
  const search = params.toString()
  return search ? `${INBOX_PATH}?${search}` : INBOX_PATH
}

/** What kind of email extraction took it for, as a chip says it. */
export const KIND_NAMES: Record<DigestKind, string> = {
  newsletter: 'Newsletter',
  promotion: 'Promotion',
  transactional: 'Account email',
  other: 'Not a newsletter'
}

export type EmailProcessing = {
  tone: Tone
  label: string
  /** Being read right now. */
  spinning: boolean
  /** The reason behind the label, where there is one. */
  detail: string | null
}

/**
 * Where extraction stands for an email, as one chip: the same words in the
 * list and in the reading pane (see src/lib/intel/status.ts).
 */
export function emailProcessing({
  status,
  error,
  kind,
  storyCount,
  superseded
}: {
  status: ExtractionStatus
  error: string | null
  kind: DigestKind | null
  storyCount: number
  /** A newer version of the issue arrived and carries its stories. */
  superseded: boolean
}): EmailProcessing {
  if (status === 'pending' && error) {
    // Waiting for its retry time after a failure that may pass: queued, not
    // being read, so no spinner.
    return {
      tone: 'brand',
      label: 'Will retry',
      spinning: false,
      detail: `${error} Trying again automatically.`
    }
  }
  if (status === 'pending' || status === 'processing') {
    return { tone: 'brand', label: 'Reading…', spinning: true, detail: null }
  }
  if (status === 'failed') {
    return {
      tone: 'danger',
      label: "Couldn't read",
      spinning: false,
      detail: error
    }
  }
  // Done without a kind: mail from a sender the user unsubscribed from is
  // listed but not read, and its error says so.
  if (!kind) {
    return {
      tone: 'neutral',
      label: 'Not read',
      spinning: false,
      detail: error
    }
  }
  if (kind !== 'newsletter') {
    return {
      tone: 'neutral',
      label: KIND_NAMES[kind],
      spinning: false,
      detail: null
    }
  }
  if (storyCount > 0) {
    return {
      tone: 'success',
      label: `${storyCount} ${storyCount === 1 ? 'story' : 'stories'}`,
      spinning: false,
      detail: null
    }
  }
  return {
    tone: 'neutral',
    label: superseded ? 'Older version' : 'No stories',
    spinning: false,
    detail: superseded
      ? 'A newer version of this issue arrived; its stories are listed with it.'
      : null
  }
}
