'use client'

import { showToast } from '@/components/toast-notification'
import { PLATFORMS, type PlatformId } from '@/lib/formats'
import {
  UPLOAD_TYPES,
  VISUAL_EXAMPLE_LIMITS,
  type VisualExampleView
} from '@/lib/visual-examples/types'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  removeVisualExample,
  uploadVisualExamples
} from './visual-examples-actions'

/**
 * The example posts under each platform's link on the Profile page: the
 * images found on the profile and the ones the user added. New images in
 * the Like my posts style are made to look like them.
 */

const labelOf = (platform: PlatformId) => PLATFORMS[platform].label

/**
 * The image shrunk in the browser to the size it is stored at, as a JPEG,
 * so a large photo fits in one request. The original when it cannot be read.
 */
async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const side = VISUAL_EXAMPLE_LIMITS.storedSide
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')
    if (!context) return file
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', 0.88)
    )
    if (!blob) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', {
      type: 'image/jpeg'
    })
  } catch {
    return file
  }
}

/** The identity's example posts, kept current as they are added and removed. */
export function useVisualExamples(
  accountId: string,
  initial: VisualExampleView[]
) {
  const [examples, setExamples] = useState(initial)

  const add = async (platform: PlatformId, files: File[]) => {
    let added = 0
    // One request per image, so each stays within the request size limit.
    for (const file of files) {
      if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) {
        showToast({
          type: 'error',
          title: 'Not an image we can use',
          message: `${file.name} is not a JPEG, PNG or WebP image.`
        })
        continue
      }
      const form = new FormData()
      form.set('accountId', accountId)
      form.set('platform', platform)
      form.append('image', await shrink(file))
      const res = await uploadVisualExamples(form)
      if (!res.success) {
        showToast({
          type: 'error',
          title: 'Could not add the image',
          message: res.error
        })
        break
      }
      added += res.added
      setExamples(res.examples)
    }
    if (added > 0) {
      showToast({
        type: 'success',
        title: `${added} example${added === 1 ? '' : 's'} added`,
        message: `New ${labelOf(platform)} images will look like these.`
      })
    }
  }

  const remove = async (id: string) => {
    const res = await removeVisualExample(accountId, id)
    if (!res.success) {
      showToast({
        type: 'error',
        title: 'Could not remove the image',
        message: res.error
      })
      return
    }
    setExamples(res.examples)
  }

  return {
    of: (platform: PlatformId) => examples.filter(e => e.platform === platform),
    /**
     * The platform whose examples a platform without any borrows: the one
     * with the most, as image generation picks (pickLookExamples).
     */
    borrowedFrom: (platform: PlatformId): PlatformId | null => {
      const counts = new Map<PlatformId, number>()
      for (const e of examples) {
        if (e.platform !== platform)
          counts.set(e.platform, (counts.get(e.platform) ?? 0) + 1)
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    },
    add,
    remove
  }
}

type ExamplesApi = ReturnType<typeof useVisualExamples>

const linkButton =
  'text-accent hover:text-accent-hover inline-flex items-center gap-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50'

/** The example posts for one platform, with Add images and remove. */
export function VisualExamplesRow({
  platform,
  api
}: {
  platform: PlatformId
  api: ExamplesApi
}) {
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const label = labelOf(platform)
  const examples = api.of(platform)
  const borrowed = examples.length === 0 ? api.borrowedFrom(platform) : null
  const uploads = examples.filter(e => e.source === 'upload').length
  const full = uploads >= VISUAL_EXAMPLE_LIMITS.uploads

  const choose = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    try {
      await api.add(
        platform,
        Array.from(files).slice(0, VISUAL_EXAMPLE_LIMITS.uploads - uploads)
      )
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span>
          {examples.length > 0
            ? examples.length === 1
              ? `New images follow this ${label} post.`
              : `New images follow these ${examples.length} ${label} posts.`
            : borrowed
              ? `No ${label} examples yet, so new ${label} images follow your ${labelOf(borrowed)} posts. Add a few images you have posted on ${label} to use those instead.`
              : `No example posts yet. Add a few images you have posted on ${label} so new images look like them.`}
        </span>
        <button
          type="button"
          disabled={busy || full}
          title={
            full
              ? `At most ${VISUAL_EXAMPLE_LIMITS.uploads} added images; remove one to add another.`
              : undefined
          }
          onClick={() => input.current?.click()}
          className={linkButton}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ImagePlus className="h-3 w-3" />
          )}
          {busy ? 'Adding…' : 'Add images'}
        </button>
        <input
          ref={input}
          type="file"
          accept={UPLOAD_TYPES.join(',')}
          multiple
          className="hidden"
          aria-label={`Add example ${label} posts`}
          onChange={e => void choose(e.target.files)}
        />
      </p>
      {examples.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Example ${label} posts`}>
          {examples.map(example => {
            const title =
              example.source === 'upload'
                ? 'Added by you'
                : 'Found on your profile'
            const thumb = (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={example.url}
                alt={title}
                className="border-border h-14 w-14 rounded-md border object-cover"
              />
            )
            return (
              <li key={example.id} className="group relative" title={title}>
                {example.postUrl ? (
                  <a href={example.postUrl} target="_blank" rel="noreferrer">
                    {thumb}
                  </a>
                ) : (
                  thumb
                )}
                <button
                  type="button"
                  disabled={removing === example.id}
                  onClick={async () => {
                    setRemoving(example.id)
                    await api.remove(example.id)
                    setRemoving(null)
                  }}
                  aria-label="Remove this example"
                  className="bg-surface border-border text-muted hover:text-foreground absolute -top-1.5 -right-1.5 hidden h-5 w-5 cursor-pointer items-center justify-center rounded-full border shadow-sm group-hover:flex focus-visible:flex"
                >
                  {removing === example.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
