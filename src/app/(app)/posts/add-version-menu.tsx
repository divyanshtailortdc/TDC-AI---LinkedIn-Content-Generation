'use client'

import { PlatformMark } from '@/components/platform-mark'
import { showToast } from '@/components/toast-notification'
import { cn } from '@/lib/cn'
import {
  canHaveImage,
  FORMAT_IDS,
  FORMATS,
  formatHint,
  formatOf,
  isCreatableFormat,
  isFormatId,
  needsImage,
  type FormatId
} from '@/lib/formats'
import { canPublishFormat } from '@/lib/publishing/platform'
import {
  Check,
  ChevronDown,
  Image as ImageIcon,
  Loader2,
  Plus
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { addPostVersion } from './actions'
import type { PostDetail } from './posts-client'

/** The enabled formats the post's idea has no post in yet, that can be created. */
function missingFormats(post: PostDetail, enabledFormats: FormatId[]): FormatId[] {
  const have = new Set(
    (post.ideaFormats?.length ? post.ideaFormats : [post.formatId ?? 'linkedin.post'])
      .filter(isFormatId)
  )
  return enabledFormats.filter(f => !have.has(f) && isCreatableFormat(f))
}

/** Where a version stands, in a word. */
function versionStatus(post: PostDetail): string {
  const published = post.publication?.status
  if (post.postedAt || published === 'published') return 'Posted'
  if (published === 'publishing') return 'Publishing'
  if (published === 'scheduled') return 'Scheduled'
  const labels: Record<string, string> = {
    awaiting_review: 'In review',
    approved: 'Approved',
    rejected: 'Rejected',
    draft: 'Draft'
  }
  return labels[post.status] ?? post.status
}

/**
 * The versions of the open post's idea (a LinkedIn post, an X post, an X
 * thread…), one click apart, with "Add a version" for the platforms it has no
 * post on yet. Each version is its own post, reviewed, approved and published
 * on its own platform.
 */
export function IdeaVersions({
  post,
  posts,
  enabledFormats,
  onOpen,
  onAdded,
  disabled,
  className
}: {
  /** The open post. */
  post: PostDetail
  /** Every loaded post: its idea's other versions are among them. */
  posts: PostDetail[]
  enabledFormats: FormatId[]
  onOpen: (postId: string) => void
  onAdded: (post: PostDetail) => void
  disabled?: boolean
  className?: string
}) {
  if (!post.ideaId) return null
  const versions = posts
    .filter(p => p.ideaId === post.ideaId)
    .sort(
      (a, b) =>
        FORMAT_IDS.indexOf(formatOf(a.formatId)) -
        FORMAT_IDS.indexOf(formatOf(b.formatId))
    )
  if (versions.length < 2 && missingFormats(post, enabledFormats).length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        'border-border bg-surface flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2',
        className
      )}
    >
      <span className="text-muted mr-1 text-[11px] font-semibold tracking-wider uppercase">
        Versions
      </span>
      {versions.map(version => {
        const active = version.id === post.id
        return (
          <button
            key={version.id}
            type="button"
            aria-current={active ? 'true' : undefined}
            disabled={disabled && !active}
            onClick={() => onOpen(version.id)}
            title={`Open the ${FORMATS[formatOf(version.formatId)].label}`}
            className={cn(
              'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              active
                ? 'border-accent bg-accent/10 text-foreground'
                : 'border-border text-muted hover:bg-surface-hover hover:text-foreground'
            )}
          >
            <PlatformMark platform={version.platform} className="h-3.5 w-3.5 shrink-0" />
            {FORMATS[formatOf(version.formatId)].label}
            <span className="text-muted text-[11px] font-medium">
              · {versionStatus(version)}
            </span>
          </button>
        )
      })}
      <AddVersionMenu
        key={post.id}
        post={post}
        enabledFormats={enabledFormats}
        disabled={disabled}
        onAdded={onAdded}
      />
    </div>
  )
}

/**
 * "Add a version": writes the post's idea up for another platform the
 * identity has turned on and the idea has no post for yet. Writing takes as
 * long as drafting one post, so the button says what it is writing until the
 * new post opens.
 */
export function AddVersionMenu({
  post,
  enabledFormats,
  onAdded,
  disabled
}: {
  post: PostDetail
  enabledFormats: FormatId[]
  onAdded: (post: PostDetail) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [writing, setWriting] = useState<FormatId | null>(null)
  // "Add an image": on until taken off, as in Create posts.
  const [withImage, setWithImage] = useState(true)
  const wrapper = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const missing = missingFormats(post, enabledFormats)
  if (!post.ideaId || (missing.length === 0 && !writing)) return null

  const write = async (formatId: FormatId) => {
    setOpen(false)
    setWriting(formatId)
    try {
      const res = await addPostVersion(post.id, formatId, withImage)
      if (res.success && res.post) {
        onAdded(res.post)
        showToast({
          type: 'success',
          title: `${FORMATS[formatId].label} written`,
          message: 'It is open for review: approve it to publish or schedule it.'
        })
      } else {
        showToast({
          type: 'error',
          title: 'Version not written',
          message: (!res.success && res.error) || 'The new version could not be written.'
        })
      }
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Version not written',
        message: err?.message || 'The new version could not be written.'
      })
    } finally {
      setWriting(null)
    }
  }

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        disabled={disabled || Boolean(writing)}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(o => !o)}
        className="border-border text-foreground hover:bg-surface-hover flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed px-3 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-70"
      >
        {writing ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Writing {FORMATS[writing].label}…</span>
          </>
        ) : (
          <>
            <Plus className="h-3.5 w-3.5" />
            <span>Add a version</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          role="menu"
          className="border-border bg-surface absolute top-full left-0 z-40 mt-1.5 max-h-[min(30rem,calc(100dvh-14rem))] w-72 overflow-y-auto rounded-xl border p-1.5 shadow-lg"
        >
          <p className="text-muted px-2 pt-1 pb-2 text-[11px] leading-snug">
            Write this idea for another platform, from the same evidence. It
            opens here for review.
          </p>
          {/* Whether the version comes with an image designed for it */}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={withImage}
            onClick={() => setWithImage(on => !on)}
            className="hover:bg-surface-hover mb-1 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left"
          >
            <span
              aria-hidden
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                withImage
                  ? 'border-accent bg-accent text-background'
                  : 'border-border'
              )}
            >
              {withImage && <Check className="h-3 w-3" />}
            </span>
            <ImageIcon aria-hidden className="text-muted h-3.5 w-3.5 shrink-0" />
            <span className="text-foreground text-xs font-semibold">
              Add an image
            </span>
          </button>
          {missing.map(id => {
            const spec = FORMATS[id]
            // What this version gets: an Instagram post always has an image,
            // a video script never does.
            const imageNote = !canHaveImage(id)
              ? 'no image'
              : needsImage(id)
                ? 'with an image (needed)'
                : withImage
                  ? 'with an image'
                  : 'text only'
            return (
              <button
                key={id}
                type="button"
                role="menuitem"
                onClick={() => void write(id)}
                className="hover:bg-surface-hover flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-left"
              >
                <span className="border-border mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border">
                  <PlatformMark platform={spec.platform} className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="text-foreground block text-xs font-semibold">
                    {spec.label}
                  </span>
                  <span className="text-muted block text-[11px] leading-snug">
                    {formatHint(id)}
                  </span>
                  <span className="text-muted block text-[11px] leading-snug">
                    {canPublishFormat(spec.platform, id)
                      ? 'Publish or schedule it from here'
                      : 'Copy it and post it by hand'}
                    {` · ${imageNote}`}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
