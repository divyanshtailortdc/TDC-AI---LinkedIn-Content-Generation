'use client'

import { docLinks, type BlogDoc } from '@/lib/blogs/doc'
import type { InternalLink, RelatedDraft } from '@/lib/blogs/types'
import { normalizeUrlForCompare } from '@/lib/urls'
import { Check, Copy, ExternalLink, Link2 } from 'lucide-react'
import { useMemo, useState } from 'react'

/**
 * Internal links: pages of the identity's site (and its published blogs) the
 * plan chose for this piece, whether the text links them yet, and Insert to
 * link the selected words (or add the suggested words at the cursor). Drafts
 * on related subjects are listed to link once they are published.
 */
export function LinksPanel({
  links,
  related,
  doc,
  disabled,
  onInsert
}: {
  links: InternalLink[]
  related: RelatedDraft[]
  doc: BlogDoc
  disabled: boolean
  onInsert: (link: InternalLink) => void
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const linked = useMemo(
    () => new Set(docLinks(doc).map(normalizeUrlForCompare)),
    [doc]
  )
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      setTimeout(() => setCopied(current => (current === url ? null : current)), 1500)
    } catch {
      // The clipboard can be blocked; the link is on screen to copy by hand.
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-muted text-xs leading-relaxed">
        Pages of your site this piece links to, or could. Select words in the
        text and press Insert to link them; with nothing selected, the
        suggested words go in at the cursor.
      </p>
      {links.length === 0 ? (
        <p className="text-muted text-sm">
          No pages of your site were found to link to.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {links.map(link => {
            const placed = linked.has(normalizeUrlForCompare(link.url))
            return (
              <li key={link.url} className="border-border rounded-xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-foreground text-sm font-medium">“{link.anchor}”</p>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted hover:text-foreground inline-flex max-w-full items-center gap-1 text-xs break-all underline-offset-2 hover:underline"
                    >
                      {link.title}
                      <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
                    </a>
                  </div>
                  {placed ? (
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                      In the text
                    </span>
                  ) : (
                    <span className="bg-surface-hover text-muted shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold">
                      Not linked yet
                    </span>
                  )}
                </div>
                {link.reason && (
                  <p className="text-muted mt-1.5 text-xs leading-relaxed">{link.reason}</p>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={disabled}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => onInsert(link)}
                    className="border-border text-foreground hover:bg-surface-hover inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium disabled:opacity-50"
                  >
                    <Link2 aria-hidden className="h-3.5 w-3.5" />
                    Insert
                  </button>
                  <button
                    type="button"
                    onClick={() => void copy(link.url)}
                    className="border-border text-foreground hover:bg-surface-hover inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium"
                  >
                    {copied === link.url ? (
                      <Check aria-hidden className="h-3.5 w-3.5" />
                    ) : (
                      <Copy aria-hidden className="h-3.5 w-3.5" />
                    )}
                    {copied === link.url ? 'Copied' : 'Copy link'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {related.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-foreground text-xs font-semibold tracking-wide uppercase">
            Related drafts
          </h3>
          <p className="text-muted text-xs">Link to these once they are published.</p>
          <ul className="text-foreground list-disc space-y-0.5 pl-4 text-sm">
            {related.map(draft => (
              <li key={draft.blogId}>{draft.title}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
