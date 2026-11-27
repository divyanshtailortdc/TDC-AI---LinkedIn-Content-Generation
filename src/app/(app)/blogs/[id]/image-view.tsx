'use client'

import { TextField } from '@/components/ui/field'
import { BLOG_LIMITS, type BlogImageView } from '@/lib/blogs/types'
import { cn } from '@/lib/cn'
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps
} from '@tiptap/react'
import { ImageOff, Loader2, PencilLine, RefreshCw, Trash2 } from 'lucide-react'
import { createContext, useContext, useId, useState } from 'react'
import { BlogDialog } from './blog-dialog'

/**
 * A section picture in the editor: the picture with its caption, and Edit
 * (alt text and caption), Make again (with an optional direction) and
 * Remove. The cursor cannot enter it; it moves as one block. Removing it
 * only takes it out of the text: earlier versions keep it.
 */

export type BlogImagesContextValue = {
  /** Each picture the text shows, by id, with a link the browser can load. */
  images: Record<string, BlogImageView>
  /** Makes the picture again; resolves when the blog has been reloaded. */
  remake: (imageId: string, direction: string) => Promise<void>
  /** The picture being made again, if any. */
  remaking: string | null
}

export const BlogImagesContext = createContext<BlogImagesContextValue>({
  images: {},
  remake: async () => {},
  remaking: null
})

const button =
  'border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium shadow-xs disabled:opacity-60'

function ImageView({ node, updateAttributes, deleteNode, selected, editor }: NodeViewProps) {
  const { images, remake, remaking } = useContext(BlogImagesContext)
  const [editing, setEditing] = useState(false)
  const [remaking_, setRemaking] = useState(false)
  const imageId = String(node.attrs.imageId ?? '')
  const alt = String(node.attrs.alt ?? '')
  const caption = String(node.attrs.caption ?? '')
  const view = images[imageId]
  const editable = editor.isEditable
  const busy = remaking === imageId
  return (
    <NodeViewWrapper
      as="figure"
      data-drag-handle
      contentEditable={false}
      className={cn(
        'blog-image group relative',
        selected && 'ring-brand ring-2 ring-offset-2'
      )}
    >
      {view ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed link or data URL, not a static asset
        <img
          src={view.src}
          alt={alt}
          width={view.width}
          height={view.height}
          className={cn('block h-auto w-full rounded-xl', busy && 'opacity-50')}
        />
      ) : (
        <p className="text-muted flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm">
          <ImageOff aria-hidden className="h-4 w-4" />
          This picture cannot be shown here. Remove it, or reload the page.
        </p>
      )}
      {busy && (
        <p className="bg-surface/90 text-foreground absolute inset-x-0 top-1/3 mx-auto flex w-max items-center gap-2 rounded-lg px-3 py-2 text-sm shadow">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          Making it again… this takes up to two minutes.
        </p>
      )}
      {caption && <figcaption>{caption}</figcaption>}
      {editable && !busy && (
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" onClick={() => setEditing(true)} className={button}>
            <PencilLine aria-hidden className="h-3.5 w-3.5" />
            Edit
          </button>
          {view && (
            <button
              type="button"
              onClick={() => setRemaking(true)}
              disabled={remaking !== null}
              className={button}
            >
              <RefreshCw aria-hidden className="h-3.5 w-3.5" />
              Make again
            </button>
          )}
          <button
            type="button"
            onClick={() => deleteNode()}
            aria-label="Remove the picture"
            className={button}
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {editing && (
        <ImageTextDialog
          alt={alt}
          caption={caption}
          onCancel={() => setEditing(false)}
          onSave={next => {
            updateAttributes(next)
            setEditing(false)
          }}
        />
      )}
      {remaking_ && (
        <RemakeDialog
          onCancel={() => setRemaking(false)}
          onConfirm={direction => {
            setRemaking(false)
            void remake(imageId, direction)
          }}
        />
      )}
    </NodeViewWrapper>
  )
}

/** The node view the blog editor draws section pictures with. */
export const imageNodeView = ReactNodeViewRenderer(ImageView)

function ImageTextDialog({
  alt,
  caption,
  onCancel,
  onSave
}: {
  alt: string
  caption: string
  onCancel: () => void
  onSave: (next: { alt: string; caption: string }) => void
}) {
  const [altText, setAltText] = useState(alt)
  const [captionText, setCaptionText] = useState(caption)
  const ids = { alt: useId(), caption: useId() }
  return (
    <BlogDialog
      title="Edit the picture's text"
      description="Alt text tells screen readers and search engines what the picture shows; the caption is for every reader."
      confirmLabel="Save"
      onCancel={onCancel}
      onConfirm={() =>
        onSave({ alt: altText.replace(/\s+/g, ' ').trim(), caption: captionText.replace(/\s+/g, ' ').trim() })
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor={ids.alt} className="text-foreground text-sm font-medium">
            Alt text (what it shows)
          </label>
          <TextField
            id={ids.alt}
            value={altText}
            maxLength={BLOG_LIMITS.altText}
            onChange={event => setAltText(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ids.caption} className="text-foreground text-sm font-medium">
            Caption
          </label>
          <TextField
            id={ids.caption}
            value={captionText}
            maxLength={BLOG_LIMITS.caption}
            onChange={event => setCaptionText(event.target.value)}
          />
        </div>
      </div>
    </BlogDialog>
  )
}

function RemakeDialog({
  onCancel,
  onConfirm
}: {
  onCancel: () => void
  onConfirm: (direction: string) => void
}) {
  const [direction, setDirection] = useState('')
  const id = useId()
  return (
    <BlogDialog
      title="Make this picture again"
      description="A new picture of the same subject, in the piece's look. Unsaved changes are saved first; the picture it replaces stays under Versions. About $0.06."
      confirmLabel="Make again"
      onCancel={onCancel}
      onConfirm={() => onConfirm(direction.trim())}
    >
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-foreground text-sm font-medium">
          What to change (optional)
        </label>
        <TextField
          id={id}
          value={direction}
          maxLength={BLOG_LIMITS.instructions}
          placeholder="e.g. warmer light, no people, show the warehouse floor"
          onChange={event => setDirection(event.target.value)}
        />
      </div>
    </BlogDialog>
  )
}
