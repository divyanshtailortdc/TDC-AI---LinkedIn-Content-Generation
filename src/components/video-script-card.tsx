'use client'

import { showToast } from '@/components/toast-notification'
import {
  copyText,
  FORMATS,
  PLATFORMS,
  videoCaptionText,
  videoScriptOf,
  type FormatId,
  type PostText
} from '@/lib/formats'
import { Check, Clapperboard, Copy, Download } from 'lucide-react'
import { useState } from 'react'

const buttonClass =
  'border-border bg-surface hover:bg-surface-hover text-foreground inline-flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors'

/** A file name from the post's first words: "five-checks-shot-list.txt". */
function fileNameFor(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '')
  return `${slug || 'video'}-shot-list.txt`
}

/**
 * The review screen's panel for a video format (a YouTube Short), in place
 * of the image tools. The app writes the script; it does not make the video.
 * The panel says so, and hands over the shot list and the caption in the
 * forms that filming and posting need.
 */
export function VideoScriptCard({
  formatId,
  post,
  copy
}: {
  formatId: FormatId
  post: PostText
  /** Writes to the clipboard; false when the browser refused. */
  copy: (text: string) => Promise<boolean>
}) {
  const spec = FORMATS[formatId]
  const platform = PLATFORMS[spec.platform].label
  const script = videoScriptOf(post)
  const [copied, setCopied] = useState<'script' | 'caption' | null>(null)

  const copyPart = async (part: 'script' | 'caption') => {
    const text = part === 'script' ? copyText(formatId, post) : videoCaptionText(formatId, post)
    if (await copy(text)) {
      setCopied(part)
      setTimeout(() => setCopied(null), 2500)
      showToast({
        type: 'success',
        title: part === 'script' ? 'Shot list copied' : 'Caption copied',
        message:
          part === 'script'
            ? 'Every shot with what to say and show, then the caption.'
            : `Ready to paste into ${platform} with the video.`
      })
    } else {
      showToast({
        type: 'error',
        title: 'Copy Failed',
        message: 'Could not write to clipboard. Please select text manually.'
      })
    }
  }

  const download = () => {
    const blob = new Blob([copyText(formatId, post)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileNameFor(script.title || script.shots[0]?.say || post.hook)
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="border-border bg-surface mt-4 space-y-3 rounded-2xl border p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
          <Clapperboard className="text-accent h-3.5 w-3.5" />
          Video
        </span>
        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
          Script only, not filmed
        </span>
      </div>

      <p className="text-muted text-xs leading-relaxed">
        This is a script to film, not a finished video: the app does not make
        the video itself. To post it:
      </p>
      <ol className="text-foreground list-decimal space-y-1 pl-4 text-xs leading-relaxed">
        <li>
          Film the {script.shots.length} shot{script.shots.length === 1 ? '' : 's'} in
          order, holding the phone upright (9:16). About {script.seconds} seconds
          spoken in all.
        </li>
        <li>Add each shot&apos;s on-screen text while you edit.</li>
        <li>
          Post it on {platform} with the caption
          {spec.platform === 'youtube' && script.title ? ' and the title' : ''}.
        </li>
      </ol>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={() => copyPart('script')} className={buttonClass}>
          {copied === 'script' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          Copy shot list
        </button>
        <button type="button" onClick={download} className={buttonClass}>
          <Download className="h-3.5 w-3.5" />
          Download (.txt)
        </button>
        <button type="button" onClick={() => copyPart('caption')} className={buttonClass}>
          {copied === 'caption' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          Copy caption
        </button>
      </div>
    </div>
  )
}
