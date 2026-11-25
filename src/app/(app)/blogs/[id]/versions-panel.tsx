'use client'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { blogArticleHtml } from '@/lib/blogs/render'
import type { BlogKind, BlogReplacedBy, BlogSnapshot } from '@/lib/blogs/types'
import { formatRelativeDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { Eye, Loader2, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  loadBlogVersion,
  loadBlogVersions,
  type BlogVersionItem
} from '../actions'
import { BlogDialog } from './blog-dialog'

const REPLACED_BY: Record<BlogReplacedBy, string> = {
  user_edit: 'Before your edits',
  regenerate: 'Before a regeneration',
  section_rewrite: 'Before a section rewrite',
  restore: 'Before a restore',
  image: 'Before a new featured image'
}

/**
 * Earlier versions of the blog's text, newest first, each kept when
 * something replaced it. Any can be previewed and restored; restoring keeps
 * the current text as a version too.
 */
export function VersionsPanel({
  blogId,
  kind,
  version,
  dirty,
  disabled,
  onRestore
}: {
  blogId: string
  kind: BlogKind
  /** The blog's lock version: the list reloads when it changes. */
  version: number
  dirty: boolean
  disabled: boolean
  /** Resolves true once restored. */
  onRestore: (revisionId: string) => Promise<boolean>
}) {
  const mounted = useHasMounted()
  const [versions, setVersions] = useState<BlogVersionItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    item: BlogVersionItem
    snapshot: BlogSnapshot
  } | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<BlogVersionItem | null>(null)
  const [restoring, setRestoring] = useState(false)

  // Loaded on open, and again whenever the blog's text changes.
  useEffect(() => {
    let cancelled = false
    loadBlogVersions(blogId).then(result => {
      if (cancelled) return
      if (result.success) {
        setVersions(result.versions)
        setError(null)
      } else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [blogId, version])

  const open = async (item: BlogVersionItem) => {
    setPreviewing(item.id)
    const result = await loadBlogVersion(blogId, item.id)
    setPreviewing(null)
    if (result.success) setPreview({ item, snapshot: result.snapshot })
    else setError(result.error)
  }

  if (error)
    return <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>
  if (!versions) {
    return (
      <p className="text-muted flex items-center gap-2 text-sm">
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading
        versions…
      </p>
    )
  }
  if (versions.length === 0) {
    return (
      <p className="text-muted text-sm">
        No earlier versions yet. Each save, regeneration, section rewrite or
        restore keeps the text it replaces here.
      </p>
    )
  }

  return (
    <>
      <ul className="space-y-2.5">
        {versions.map(item => (
          <li key={item.id} className="border-border rounded-xl border p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-foreground text-sm font-medium">
                Version {item.number}
              </p>
              <p className="text-muted text-xs">
                {mounted ? formatRelativeDate(item.createdAt) : ''}
              </p>
            </div>
            <p className="text-muted mt-0.5 text-xs">
              {REPLACED_BY[item.replacedBy]} ·{' '}
              {item.wordCount.toLocaleString('en-US')} words
            </p>
            {item.instruction && (
              <p className="text-muted mt-1 line-clamp-2 text-xs italic">
                “{item.instruction}”
              </p>
            )}
            <p className="text-foreground mt-1 line-clamp-1 text-xs">
              {item.title}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => open(item)}
                disabled={previewing !== null}
                className="border-border text-foreground hover:bg-surface-hover inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium"
              >
                {previewing === item.id ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eye aria-hidden className="h-3.5 w-3.5" />
                )}
                Preview
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setConfirm(item)}
                className="border-border text-foreground hover:bg-surface-hover inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium disabled:opacity-50"
              >
                <RotateCcw aria-hidden className="h-3.5 w-3.5" />
                Restore
              </button>
            </div>
          </li>
        ))}
      </ul>

      {preview && (
        <BlogDialog
          wide
          title={`Version ${preview.item.number}`}
          description={`${REPLACED_BY[preview.item.replacedBy]} · ${preview.item.wordCount.toLocaleString('en-US')} words`}
          onCancel={() => setPreview(null)}
        >
          <article
            className="blog-doc"
            // Built by blogArticleHtml from validated document JSON, every text escaped.
            dangerouslySetInnerHTML={{
              __html: blogArticleHtml({
                kind,
                ...preview.snapshot,
                searchIntent: preview.snapshot.searchIntent ?? '',
                // The version's image is not loaded here: its words are what differ.
                featuredImage: null,
                verification: null,
                sources: []
              })
            }}
          />
        </BlogDialog>
      )}

      {confirm && (
        <ConfirmDialog
          title={`Restore version ${confirm.number}?`}
          description={
            dirty
              ? 'Your unsaved changes will be lost. The current saved text is kept as a version, so this can be undone.'
              : 'The current text is kept as a version, so this can be undone.'
          }
          confirmLabel="Restore"
          pendingLabel="Restoring…"
          pending={restoring}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setRestoring(true)
            const done = await onRestore(confirm.id)
            setRestoring(false)
            if (done) setConfirm(null)
          }}
        />
      )}
    </>
  )
}
