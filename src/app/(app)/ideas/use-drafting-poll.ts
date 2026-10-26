'use client'

import { useEffect, useRef } from 'react'
import { fetchIdeaStatuses } from './actions'

const POLL_INTERVAL_MS = 5000

export type IdeaStatus = { id: string; status: string }

/**
 * Follows ideas being drafted in the background (see the drafting queue):
 * `onStatuses` gets their statuses on every poll, and `onDone` once none is
 * still drafting. Pass no ids to stop.
 */
export function useDraftingPoll(
  ideaIds: string[],
  handlers: {
    onStatuses: (ideas: IdeaStatus[]) => void
    onDone: (ideas: IdeaStatus[]) => void
  }
) {
  // The latest handlers, so a re-render does not restart the polling.
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  const key = ideaIds.join(',')
  useEffect(() => {
    if (!key) return
    const ids = key.split(',')
    let stopped = false
    const interval = setInterval(async () => {
      const res = await fetchIdeaStatuses(ids)
      if (stopped || !res.success) return
      handlersRef.current.onStatuses(res.ideas)
      if (!res.ideas.some(idea => idea.status === 'drafting')) {
        stopped = true
        clearInterval(interval)
        handlersRef.current.onDone(res.ideas)
      }
    }, POLL_INTERVAL_MS)
    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [key])
}
