'use client'

import { Button } from '@/components/button'
import { TextField } from '@/components/ui/field'
import { BLOG_LIMITS, type FeaturedImage } from '@/lib/blogs/types'
import { Download, ImageIcon, RefreshCw, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'

/**
 * The piece's featured image above its title: the picture, its alt text and
 * caption (saved with the text), and Make again (with what to change),
 * Remove and Download. A failed attempt says why and offers Make again.
 */
export function FeaturedImageCard({
  image,
  url,
  alt,
  caption,
  making,
  disabled,
  onAlt,
  onCaption,
  onMake,
  onRemove,
  onDownload
}: {
  image: FeaturedImage | null
  /** A link the browser can load (signed). */
  url: string | null
  alt: string
  caption: string
  making: boolean
  disabled: boolean
  onAlt: (alt: string) => void
  onCaption: (caption: string) => void
  /** Resolves when the new image is in (or failed). */
  onMake: (direction: string) => Promise<void>
  onRemove: () => void
  onDownload: () => void
}) {
  const [asking, setAsking] = useState(false)
  const [direction, setDirection] = useState('')
  const altId = useId()
  const captionId = useId()
  const directionId = useId()
  const ready = image?.status === 'ready' && url

  const make = async () => {
    await onMake(direction.trim())
    setAsking(false)
    setDirection('')
  }

  return (
    <section aria-label="Featured image" className="space-y-3">
      {ready ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed link or data URL, not a static asset
        <img
          src={url}
          alt={alt}
          width={image.width}
          height={image.height}
          className="border-border aspect-video w-full rounded-xl border object-cover"
        />
      ) : (
        <div className="border-border bg-surface-hover/40 text-muted flex aspect-[16/6] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 text-center text-sm">
          <ImageIcon aria-hidden className="h-5 w-5" />
          {making
            ? 'Making the image… about a minute.'
            : image?.status === 'failed'
              ? `The image could not be made: ${image.error}`
              : 'No featured image.'}
        </div>
      )}

      {ready && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={altId} className="text-muted text-xs font-medium">
              Alt text (what the picture shows)
            </label>
            <TextField
              id={altId}
              value={alt}
              maxLength={BLOG_LIMITS.altText}
              disabled={disabled}
              onChange={event => onAlt(event.target.value)}
              className="py-1.5"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={captionId} className="text-muted text-xs font-medium">
              Caption (optional)
            </label>
            <TextField
              id={captionId}
              value={caption}
              maxLength={BLOG_LIMITS.caption}
              disabled={disabled}
              onChange={event => onCaption(event.target.value)}
              className="py-1.5"
            />
          </div>
        </div>
      )}

      {asking ? (
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={event => {
            event.preventDefault()
            void make()
          }}
        >
          <label htmlFor={directionId} className="sr-only">
            What should change in the picture?
          </label>
          <TextField
            id={directionId}
            autoFocus
            value={direction}
            maxLength={BLOG_LIMITS.instructions}
            onChange={event => setDirection(event.target.value)}
            placeholder="What should change? e.g. warmer light, no people (optional)"
            className="min-w-48 flex-1 basis-64 py-1"
          />
          <Button size="sm" type="submit" loading={making} disabled={disabled}>
            Make it
          </Button>
          <Button size="sm" variant="secondary" type="button" disabled={making} onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAsking(true)}
            loading={making}
            disabled={disabled}
          >
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            {ready ? 'Make again' : 'Make an image'}
          </Button>
          {ready && (
            <>
              <Button size="sm" variant="secondary" onClick={onDownload} disabled={making}>
                <Download aria-hidden className="h-3.5 w-3.5" />
                Download
              </Button>
              <Button size="sm" variant="secondary" onClick={onRemove} disabled={disabled || making}>
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
                Remove
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
