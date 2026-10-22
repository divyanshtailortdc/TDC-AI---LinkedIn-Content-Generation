'use client'

import { useState } from 'react'
import {
  Check,
  Copy,
  Globe,
  MessageSquare,
  MoreHorizontal,
  Repeat2,
  Send,
  Shuffle,
  ThumbsUp,
  ZoomIn
} from 'lucide-react'
import Image from 'next/image'
import { linkedInHashtags, toLinkedInText } from '@/lib/post-text'

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
  /**
   * Other openings to offer beside the hook. With `onSelectHook` set, a Swap
   * hook button next to the hook lists them; picking one replaces the hook.
   */
  hookOptions?: Array<{ label: string; content: string }>
  onSelectHook?: (hook: string) => void
  hookSwapDisabled?: boolean
  /** Shown under the post as the author's own first comment, as LinkedIn does. */
  firstComment?: string | null
  onCopyFirstComment?: () => void
  firstCommentCopied?: boolean
}

/** A comment longer than this is folded behind "…see more", as LinkedIn does. */
const COMMENT_FOLD_CHARS = 180

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
  onMediaClick,
  hookOptions = [],
  onSelectHook,
  hookSwapDisabled = false,
  firstComment,
  onCopyFirstComment,
  firstCommentCopied = false
}: LinkedInPreviewProps) {
  const [showFullPost, setShowFullPost] = useState(false)
  const [showHookOptions, setShowHookOptions] = useState(false)
  const [showFullComment, setShowFullComment] = useState(false)
  const canSwapHook = Boolean(onSelectHook) && hookOptions.length > 0
  // Every part is shown as Copy puts it on the clipboard, so the preview is
  // what pastes into LinkedIn.
  const comment = toLinkedInText(firstComment)
  const isCommentLong = comment.length > COMMENT_FOLD_CHARS

  const cleanHook = toLinkedInText(hook)
  const shownBody = toLinkedInText(body)
  const shownCta = toLinkedInText(cta)
  const shownHashtags = linkedInHashtags(hashtags)
  const isHookLongerThanFold = cleanHook.length > foldCharLimit
  const visibleHookBeforeFold = cleanHook.slice(0, foldCharLimit)
  const hookOverflowAfterFold = cleanHook.slice(foldCharLimit)

  return (
    <div className="w-full  rounded-xl border border-[#e0e0e0] dark:border-border bg-white dark:bg-surface shadow-sm font-sans text-neutral-900 dark:text-neutral-100 overflow-hidden text-sm">
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
            <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate max-w-85">
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
          className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1 rounded-full hover:bg-neutral-100 dark:hover:bg-surface-hover"
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>

      {/* Post Text Area with Fold Line indicator */}
      <div className="px-4 py-2 text-[14px] leading-[1.45] wrap-break-word whitespace-pre-wrap selection:bg-[#0a66c2]/20">
        {/* Hook preview, with the swap control beside it */}
        <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 font-bold text-neutral-950 dark:text-neutral-50">
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
          {canSwapHook && (
            <button
              type="button"
              onClick={() => setShowHookOptions(open => !open)}
              aria-expanded={showHookOptions}
              title="Swap hook"
              className={`mt-0.5 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                showHookOptions
                  ? 'border-[#0a66c2] bg-[#0a66c2]/10 text-[#0a66c2] dark:text-[#70b5f9]'
                  : 'border-neutral-300 text-neutral-600 hover:border-[#0a66c2] hover:text-[#0a66c2] dark:border-neutral-700 dark:text-neutral-300'
              }`}
            >
              <Shuffle className="h-3 w-3" />
              Swap hook
            </button>
          )}
        </div>

        {/* Not part of the post: the openings to choose from */}
        {canSwapHook && showHookOptions && (
          <div className="mt-2 space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-2 whitespace-normal dark:border-border dark:bg-surface-hover/60">
            {hookOptions.map(option => {
              const optionText = toLinkedInText(option.content)
              const current = optionText === cleanHook
              return (
                <button
                  key={`${option.label}-${option.content}`}
                  type="button"
                  disabled={current || hookSwapDisabled}
                  onClick={() => {
                    onSelectHook?.(option.content)
                    setShowHookOptions(false)
                  }}
                  className={`block w-full rounded-md border px-2.5 py-2 text-left text-xs leading-snug transition-colors ${
                    current
                      ? 'cursor-default border-[#0a66c2]/40 bg-[#0a66c2]/5 text-neutral-900 dark:text-neutral-100'
                      : 'cursor-pointer border-transparent bg-white text-neutral-700 hover:border-[#0a66c2]/40 disabled:cursor-wait disabled:opacity-60 dark:bg-surface dark:text-neutral-300'
                  }`}
                >
                  <span className="mb-0.5 block text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">
                    {option.label}
                    {current && ' · in use'}
                  </span>
                  {optionText}
                </button>
              )
            })}
          </div>
        )}

        {/* Post Body & CTA */}
        {(!isHookLongerThanFold || showFullPost) && (
          <div className="mt-3 space-y-3 text-neutral-800 dark:text-neutral-200">
            <div>{shownBody}</div>
            {shownCta && <div className="font-medium text-neutral-900 dark:text-neutral-100">{shownCta}</div>}
          </div>
        )}

        {/* Hashtags */}
        {shownHashtags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {shownHashtags.map(tag => (
              <span
                key={tag}
                className="text-[#0a66c2] dark:text-[#70b5f9] font-semibold text-[13px] hover:underline cursor-pointer"
              >
                {tag}
              </span>
            ))}
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
        <div className="mt-2 border-y border-neutral-200 dark:border-border bg-neutral-100 dark:bg-surface-hover/60 relative">
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
                className="h-auto w-full"
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
              className="h-auto w-full"
              unoptimized
            />
          )}
        </div>
      )}

      {/* Reaction Counts Bar */}
      <div className="px-4 py-2.5 flex items-center justify-between text-xs text-neutral-500 border-b border-neutral-100 dark:border-border">
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
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md hover:bg-neutral-100 dark:hover:bg-surface-hover text-xs font-semibold transition-colors"
        >
          <ThumbsUp className="w-4 h-4" />
          <span>Like</span>
        </button>
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md hover:bg-neutral-100 dark:hover:bg-surface-hover text-xs font-semibold transition-colors"
        >
          <MessageSquare className="w-4 h-4" />
          <span>Comment</span>
        </button>
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md hover:bg-neutral-100 dark:hover:bg-surface-hover text-xs font-semibold transition-colors"
        >
          <Repeat2 className="w-4 h-4" />
          <span>Repost</span>
        </button>
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md hover:bg-neutral-100 dark:hover:bg-surface-hover text-xs font-semibold transition-colors"
        >
          <Send className="w-4 h-4" />
          <span>Send</span>
        </button>
      </div>

      {/* First comment, laid out like a LinkedIn comment by the author */}
      {comment && (
        <div className="border-t border-neutral-100 px-4 pt-3 pb-3 dark:border-border">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0a66c2] text-[11px] font-bold text-white">
              {authorInitials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="rounded-lg rounded-tl-none bg-neutral-100 px-3 py-2 dark:bg-surface-hover">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold">
                    {authorName}
                  </span>
                  <span className="shrink-0 rounded bg-neutral-500/15 px-1 text-[10px] font-semibold text-neutral-600 dark:text-neutral-300">
                    Author
                  </span>
                </div>
                {authorHeadline && (
                  <p className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                    {authorHeadline}
                  </p>
                )}
                <p className="mt-1.5 text-[13px] leading-[1.45] wrap-break-word whitespace-pre-wrap text-neutral-800 dark:text-neutral-200">
                  {isCommentLong && !showFullComment
                    ? `${comment.slice(0, COMMENT_FOLD_CHARS).trimEnd()}…`
                    : comment}
                  {isCommentLong && (
                    <button
                      type="button"
                      onClick={() => setShowFullComment(open => !open)}
                      className="ml-1 cursor-pointer font-semibold text-neutral-500 hover:text-[#0a66c2] hover:underline"
                    >
                      {showFullComment ? 'see less' : 'see more'}
                    </button>
                  )}
                </p>
              </div>
              <div className="mt-1 flex items-center gap-3 px-1 text-[11px] font-semibold text-neutral-500">
                <span>Like</span>
                <span>Reply</span>
                {onCopyFirstComment && (
                  <button
                    type="button"
                    onClick={onCopyFirstComment}
                    className="ml-auto inline-flex cursor-pointer items-center gap-1 text-[#0a66c2] hover:underline dark:text-[#70b5f9]"
                  >
                    {firstCommentCopied ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {firstCommentCopied ? 'Copied' : 'Copy comment'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
