'use client'

import { Button, buttonClassName } from '@/components/button'
import { showToast } from '@/components/toast-notification'
import { FIELD_CLASS, LABEL_CLASS } from '@/components/ui/field'
import { copyText } from '@/lib/blogs/browser-export'
import { sharePath } from '@/lib/blogs/share'
import { Copy, ExternalLink, Link2Off } from 'lucide-react'
import { useId, useState } from 'react'
import { BlogDialog } from './blog-dialog'

/**
 * The blog's public link: made here, copied or opened, or turned off. The
 * link shows the saved text and follows later saves, to anyone who has it.
 */
export function ShareDialog({
  token,
  dirty,
  onShare,
  onCancel
}: {
  /** The link's secret; null when the blog is not shared. */
  token: string | null
  /** The editor has changes the link does not show until they are saved. */
  dirty: boolean
  /** Turns the link on or off; resolves false when that failed. */
  onShare: (shared: boolean) => Promise<boolean>
  onCancel: () => void
}) {
  const [pending, setPending] = useState<'on' | 'off' | null>(null)
  const id = useId()
  // Opened from a click, so always in the browser.
  const url = token ? `${window.location.origin}${sharePath(token)}` : null

  const change = async (shared: boolean) => {
    setPending(shared ? 'on' : 'off')
    await onShare(shared)
    setPending(null)
  }

  return (
    <BlogDialog
      title="Share a link"
      description="Anyone with the link can read this blog in their browser, without signing in. Search engines are asked not to list it."
      confirmLabel={url ? undefined : 'Create link'}
      pending={pending !== null}
      onCancel={onCancel}
      onConfirm={() => void change(true)}
    >
      {url ? (
        <div className="space-y-4">
          <div>
            <label htmlFor={`${id}-url`} className={LABEL_CLASS}>
              Public link
            </label>
            <input
              id={`${id}-url`}
              readOnly
              value={url}
              onFocus={event => event.currentTarget.select()}
              className={FIELD_CLASS}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                copyText(url).then(
                  () => showToast({ type: 'success', title: 'Link copied' }),
                  () =>
                    showToast({
                      type: 'error',
                      title: 'Could not copy',
                      message: 'Select the link and copy it yourself.'
                    })
                )
              }
            >
              <Copy aria-hidden className="h-4 w-4" />
              Copy link
            </Button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}
            >
              <ExternalLink aria-hidden className="h-4 w-4" />
              Open
            </a>
            <Button
              size="sm"
              variant="secondary"
              loading={pending === 'off'}
              disabled={pending !== null}
              onClick={() => void change(false)}
              className="text-rose-600 sm:ml-auto dark:text-rose-400"
            >
              <Link2Off aria-hidden className="h-4 w-4" />
              Stop sharing
            </Button>
          </div>
          <p className="text-muted text-sm leading-relaxed">
            It shows the last saved version and follows your later saves.
            {dirty && ' Your unsaved changes appear once you save them.'}{' '}
            Stop sharing turns this link off for everyone; sharing again makes
            a new one.
          </p>
        </div>
      ) : (
        <p className="text-muted text-sm leading-relaxed">
          The link shows the last saved version
          {dirty && ', not your unsaved changes,'} and follows your later
          saves. You can turn it off at any time.
        </p>
      )}
    </BlogDialog>
  )
}
