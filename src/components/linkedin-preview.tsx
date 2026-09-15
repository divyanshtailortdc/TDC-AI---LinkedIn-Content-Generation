'use client'

import { useState } from 'react'
import { ThumbsUp, MessageSquare, Repeat2, Send, Globe, MoreHorizontal, ZoomIn } from 'lucide-react'
import Image from 'next/image'

interface LinkedInPreviewProps {
  authorName: string
  authorHeadline?: string | null
  authorInitials?: string
  hook: string
  body: string
  cta?: string | null
  hashtags?: string[]
  mediaUrl?: string | null
  mediaAltText?: string | null
  foldCharLimit?: number
  /** When set, the attached image becomes clickable (e.g. to open a zoom view). */
  onMediaClick?: () => void
}

export function LinkedInPreview({
  authorName,
  authorHeadline,
  authorInitials = 'IN',
  hook,
  body,
  cta,
  hashtags = [],
  mediaUrl,
  mediaAltText,
  foldCharLimit = 200,
  onMediaClick
}: LinkedInPreviewProps) {
  const [showFullPost, setShowFullPost] = useState(false)

  const cleanHook = hook.trim()
  const isHookLongerThanFold = cleanHook.length > foldCharLimit
  const visibleHookBeforeFold = cleanHook.slice(0, foldCharLimit)
  const hookOverflowAfterFold = cleanHook.slice(foldCharLimit)

  return (
    <div className="w-full max-w-[555px] rounded-xl border border-[#e0e0e0] dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm font-sans text-neutral-900 dark:text-neutral-100 overflow-hidden text-sm">
      {/* LinkedIn Post Header */}
      <div className="p-4 pb-2 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-[#0a66c2] text-white flex items-center justify-center font-bold text-base shrink-0 shadow-xs">
            {authorInitials}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="font-semibold text-sm hover:text-[#0a66c2] hover:underline cursor-pointer truncate">
                {authorName}
              </span>
              <span className="text-xs text-neutral-500">• 1st</span>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate max-w-[340px]">
              {authorHeadline || 'Industry Leader & Content Creator'}
            </p>
            <div className="flex items-center gap-1 text-[11px] text-neutral-400 mt-0.5">
              <span>1d</span>
              <span>•</span>
              <Globe className="w-3 h-3" />
            </div>
          </div>
        </div>
        <button
          type="button"
          className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>

      {/* Post Text Area with Fold Line indicator */}
      <div className="px-4 py-2 text-[14px] leading-[1.45] break-words whitespace-pre-wrap selection:bg-[#0a66c2]/20">
        {/* Hook preview */}
        <div className="font-medium text-neutral-950 dark:text-neutral-50">
          <span>{visibleHookBeforeFold}</span>

          {isHookLongerThanFold && !showFullPost && (
            <>
              <button
                type="button"
                onClick={() => setShowFullPost(true)}
                aria-expanded={false}
                className="inline p-0 text-neutral-500 hover:text-[#0a66c2] hover:underline cursor-pointer font-semibold ml-0.5"
              >
                ...see more
              </button>
              {/* Visual Fold Indicator Bar for creator feedback */}
              <div className="my-2 border-t-2 border-dashed border-amber-400/80 bg-amber-50 dark:bg-amber-950/30 px-2 py-1 rounded text-[11px] text-amber-700 dark:text-amber-400 flex items-center justify-between font-mono select-none">
                <span>⚠️ Feed fold line ({foldCharLimit} chars)</span>
                <span>{cleanHook.length} chars</span>
              </div>
            </>
          )}

          {isHookLongerThanFold && showFullPost && (
            <span>{hookOverflowAfterFold}</span>
          )}
        </div>

        {/* Post Body & CTA */}
        {(!isHookLongerThanFold || showFullPost) && (
          <div className="mt-3 space-y-3 text-neutral-800 dark:text-neutral-200">
            <div>{body}</div>
            {cta && <div className="font-medium text-neutral-900 dark:text-neutral-100">{cta}</div>}
          </div>
        )}

        {/* Hashtags */}
        {hashtags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {hashtags.map((tag, i) => {
              const formatted = tag.startsWith('#') ? tag : `#${tag}`
              return (
                <span
                  key={i}
                  className="text-[#0a66c2] dark:text-[#70b5f9] font-semibold text-[13px] hover:underline cursor-pointer"
                >
                  {formatted}
                </span>
              )
            })}
          </div>
        )}

        {/* Toggle see more / collapse */}
        {isHookLongerThanFold && (
          <button
            type="button"
            onClick={() => setShowFullPost(!showFullPost)}
            className="mt-2 text-xs font-semibold text-[#0a66c2] hover:underline"
          >
            {showFullPost ? 'Collapse preview' : 'Expand full post'}
          </button>
        )}
      </div>

      {/* Media Attachment Preview */}
      {mediaUrl && (
        <div className="mt-2 border-y border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800/40 relative">
          {onMediaClick ? (
            <button
              type="button"
              onClick={onMediaClick}
              aria-label="Zoom image"
              className="group block w-full cursor-zoom-in"
            >
              <Image
                src={mediaUrl}
                alt={mediaAltText || 'Post illustration'}
                width={1200}
                height={630}
                className="w-full max-h-[380px] object-cover"
                unoptimized
              />
              <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <ZoomIn className="h-3 w-3" />
                Zoom
              </span>
            </button>
          ) : (
            <Image
              src={mediaUrl}
              alt={mediaAltText || 'Post illustration'}
              width={1200}
              height={630}
              className="w-full max-h-[380px] object-cover"
              unoptimized
            />
          )}
        </div>
      )}

      {/* Reaction Counts Bar */}
      <div className="px-4 py-2.5 flex items-center justify-between text-xs text-neutral-500 border-b border-neutral-100 dark:border-neutral-800/80">
        <div className="flex items-center gap-1.5">
          <div className="flex -space-x-1">
            <span className="w-4 h-4 rounded-full bg-[#0a66c2] text-white flex items-center justify-center text-[9px]">
              👍
            </span>
            <span className="w-4 h-4 rounded-full bg-[#df704d] text-white flex items-center justify-center text-[9px]">
              ❤️
            </span>
            <span className="w-4 h-4 rounded-full bg-[#6dae4f] text-white flex items-center justify-center text-[9px]">
              💡
            </span>
          </div>
          <span>42</span>
        </div>
        <div className="flex items-center gap-2">
          <span>12 comments</span>
          <span>•</span>
          <span>4 reposts</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="px-2 py-1 flex items-center justify-between text-neutral-600 dark:text-neutral-400">
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold transition-colors"
        >
          <ThumbsUp className="w-4 h-4" />
          <span>Like</span>
        </button>
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold transition-colors"
        >
          <MessageSquare className="w-4 h-4" />
          <span>Comment</span>
        </button>
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold transition-colors"
        >
          <Repeat2 className="w-4 h-4" />
          <span>Repost</span>
        </button>
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold transition-colors"
        >
          <Send className="w-4 h-4" />
          <span>Send</span>
        </button>
      </div>
    </div>
  )
}
