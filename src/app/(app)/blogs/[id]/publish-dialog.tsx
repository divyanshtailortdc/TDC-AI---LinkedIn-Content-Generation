'use client'

import { FIELD_CLASS, TextField } from '@/components/ui/field'
import {
  BLOG_DESTINATION_IDS,
  BLOG_DESTINATIONS,
  DEFAULT_BLOG_DESTINATION,
  localDay,
  publicationTimestamp,
  type BlogDestinationId
} from '@/lib/blogs/destinations'
import { BLOG_LIMITS } from '@/lib/blogs/types'
import { cn } from '@/lib/cn'
import { useId, useState } from 'react'
import { BlogDialog } from './blog-dialog'

/** Where and when a blog went out, as the dialog sends it. */
export type PublishDetails = {
  destination: BlogDestinationId
  url: string
  /** The moment it went out, as an ISO timestamp. */
  publishedAt: string
}

/**
 * Marks the blog published, or changes where and when it was: the
 * destination (a website or CMS, never a social platform), the live page
 * and the day it went out.
 */
export function PublishDialog({
  initial,
  editing,
  onCancel,
  onConfirm
}: {
  initial: {
    destination: BlogDestinationId | null
    url: string | null
    publishedAt: string | null
  }
  /** It is published already: the details are being changed. */
  editing: boolean
  onCancel: () => void
  /** Resolves true once saved. */
  onConfirm: (details: PublishDetails) => Promise<boolean>
}) {
  const [destination, setDestination] = useState<BlogDestinationId>(
    initial.destination ?? DEFAULT_BLOG_DESTINATION
  )
  const [url, setUrl] = useState(initial.url ?? '')
  // Days are the browser's own; "today" is fixed when the dialog opens.
  const [today] = useState(() => localDay(new Date()))
  const [day, setDay] = useState(() =>
    initial.publishedAt ? localDay(initial.publishedAt) : today
  )
  const [pending, setPending] = useState(false)
  const id = useId()
  const dayValid = /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today

  return (
    <BlogDialog
      title={editing ? 'Publishing details' : 'Mark as published'}
      description={
        editing
          ? 'Change where this blog is published and when it went out.'
          : 'Blogs go out by hand: paste it into your website, then mark it here so you know which ones are live.'
      }
      confirmLabel={editing ? 'Save details' : 'Mark as published'}
      confirmDisabled={!dayValid}
      pending={pending}
      onCancel={onCancel}
      onConfirm={async () => {
        setPending(true)
        const done = await onConfirm({
          destination,
          url,
          publishedAt: publicationTimestamp(
            day,
            new Date(),
            initial.publishedAt
          )
        })
        setPending(false)
        if (done) onCancel()
      }}
    >
      <div className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-foreground text-sm font-medium">
            Where is it published?
          </legend>
          <div className="flex flex-wrap gap-2">
            {BLOG_DESTINATION_IDS.map(option => (
              <label
                key={option}
                className={cn(
                  'border-border hover:bg-surface-hover/60 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  destination === option && 'border-brand bg-brand/5'
                )}
              >
                <input
                  type="radio"
                  name={`${id}-destination`}
                  value={option}
                  checked={destination === option}
                  onChange={() => setDestination(option)}
                  className="accent-brand"
                />
                <span className="text-foreground font-medium">
                  {BLOG_DESTINATIONS[option].name}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <label
            htmlFor={`${id}-url`}
            className="text-foreground block text-sm font-medium"
          >
            Live URL (optional)
          </label>
          <TextField
            id={`${id}-url`}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={BLOG_LIMITS.url}
            value={url}
            onChange={event => setUrl(event.target.value)}
            placeholder={BLOG_DESTINATIONS[destination].urlPlaceholder}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor={`${id}-day`}
            className="text-foreground block text-sm font-medium"
          >
            Published on
          </label>
          <input
            id={`${id}-day`}
            type="date"
            required
            max={today}
            value={day}
            onChange={event => setDay(event.target.value)}
            className={cn(FIELD_CLASS, 'w-auto')}
          />
          {!dayValid && (
            <p className="text-xs text-rose-600 dark:text-rose-400">
              Pick a day up to today.
            </p>
          )}
        </div>
      </div>
    </BlogDialog>
  )
}
