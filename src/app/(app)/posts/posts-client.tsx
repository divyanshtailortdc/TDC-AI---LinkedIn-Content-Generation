'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PageHeader } from '@/components/page-header'
import { LinkedInPreview } from '@/components/linkedin-preview'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Edit2,
  ExternalLink,
  FileCheck,
  Filter,
  Image as ImageIcon,
  Layers,
  Loader2,
  MessageSquare,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import type { LintFinding } from '~/lib/lint/run-linter'
import {
  approveDraft,
  regeneratePostMediaAction,
  rejectDraft,
  removePostMediaAction,
  updateDraft,
  updatePostMediaAction
} from './actions'

export interface PostDetail {
  id: string
  accountId: string
  accountName: string
  accountHeadline?: string | null
  hook: string
  body: string
  cta?: string | null
  firstComment?: string | null
  hashtags: string[]
  charCount: number
  status: string
  createdAt: Date | string
  variants: Array<{ id: string; variantType: string; content: string }>
  citations: Array<{
    id: string
    claim: string
    quote?: string | null
    sourceUrl?: string | null
    sourceTitle?: string | null
  }>
  media?: {
    mode: string
    imageUrl?: string | null
    altText?: string | null
    promptOrQuery?: string | null
    fallbackApplied?: boolean
  } | null
  lintFindings: LintFinding[]
}

export function PostsClient({
  initialPosts,
  accounts
}: {
  initialPosts: PostDetail[]
  accounts: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [posts, setPosts] = useState<PostDetail[]>(initialPosts)
  const [selectedPostId, setSelectedPostId] = useState<string>(
    initialPosts[0]?.id || ''
  )
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all')

  // Active post editing state
  const activePost = posts.find((p) => p.id === selectedPostId) || posts[0]
  const [isEditing, setIsEditing] = useState(false)
  const [editedHook, setEditedHook] = useState(activePost?.hook || '')
  const [editedBody, setEditedBody] = useState(activePost?.body || '')
  const [editedComment, setEditedComment] = useState(activePost?.firstComment || '')

  // Copy feedback
  const [copiedPost, setCopiedPost] = useState(false)
  const [copiedComment, setCopiedComment] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Media management state
  const [isMediaLoading, setIsMediaLoading] = useState(false)
  const [mediaLoadingText, setMediaLoadingText] = useState('')
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [showStockInput, setShowStockInput] = useState(false)
  const [stockSearchQuery, setStockSearchQuery] = useState('')
  const [showCustomUrlInput, setShowCustomUrlInput] = useState(false)
  const [customImageUrl, setCustomImageUrl] = useState('')

  // Filter posts
  const filteredPosts = posts.filter((p) => {
    if (selectedAccountId === 'all') return true
    return p.accountId === selectedAccountId
  })

  const handleSelectPost = (post: PostDetail) => {
    setSelectedPostId(post.id)
    setEditedHook(post.hook)
    setEditedBody(post.body)
    setEditedComment(post.firstComment || '')
    setIsEditing(false)
    setShowStockInput(false)
    setShowCustomUrlInput(false)
    setMediaError(null)
  }

  const handleRegenerateAIMedia = async () => {
    if (!activePost) return
    setIsMediaLoading(true)
    setMediaLoadingText('Generating AI visual with model fallback...')
    setMediaError(null)

    try {
      const res = await regeneratePostMediaAction(activePost.id, {
        mode: 'ai_generated'
      })
      if (res.success && res.media) {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === activePost.id ? { ...p, media: res.media } : p
          )
        )
      } else {
        setMediaError(res.error || 'Failed to generate visual')
      }
    } catch (err: any) {
      setMediaError(err?.message || 'Failed to generate visual')
    } finally {
      setIsMediaLoading(false)
      setMediaLoadingText('')
    }
  }

  const handleSearchStockMedia = async () => {
    if (!activePost) return
    setIsMediaLoading(true)
    setMediaLoadingText('Searching royalty-free stock photography...')
    setMediaError(null)

    try {
      const res = await regeneratePostMediaAction(activePost.id, {
        mode: 'stock',
        customPrompt: stockSearchQuery.trim() || undefined
      })
      if (res.success && res.media) {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === activePost.id ? { ...p, media: res.media } : p
          )
        )
        setShowStockInput(false)
        setStockSearchQuery('')
      } else {
        setMediaError(res.error || 'Failed to search stock visual')
      }
    } catch (err: any) {
      setMediaError(err?.message || 'Failed to search stock visual')
    } finally {
      setIsMediaLoading(false)
      setMediaLoadingText('')
    }
  }

  const handleApplyCustomUrl = async () => {
    if (!activePost) return
    const url = customImageUrl.trim()
    if (!url) {
      setMediaError('Please enter a valid image URL')
      return
    }

    setIsMediaLoading(true)
    setMediaLoadingText('Attaching custom image...')
    setMediaError(null)

    try {
      const res = await updatePostMediaAction(activePost.id, {
        mode: 'stock',
        imageUrl: url,
        altText: `Custom visual illustration for: ${activePost.hook.slice(0, 50)}`
      })

      if (res.success && res.media) {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === activePost.id ? { ...p, media: res.media } : p
          )
        )
        setShowCustomUrlInput(false)
        setCustomImageUrl('')
      } else {
        setMediaError(res.error || 'Failed to update image URL')
      }
    } catch (err: any) {
      setMediaError(err?.message || 'Failed to update image URL')
    } finally {
      setIsMediaLoading(false)
      setMediaLoadingText('')
    }
  }

  const handleRemoveMedia = async () => {
    if (!activePost) return
    setIsMediaLoading(true)
    setMediaLoadingText('Switching to text-only mode...')
    setMediaError(null)

    try {
      const res = await removePostMediaAction(activePost.id)
      if (res.success) {
        setPosts((prev) =>
          prev.map((p) => (p.id === activePost.id ? { ...p, media: null } : p))
        )
      } else {
        setMediaError(res.error || 'Failed to remove media')
      }
    } catch (err: any) {
      setMediaError(err?.message || 'Failed to remove media')
    } finally {
      setIsMediaLoading(false)
      setMediaLoadingText('')
    }
  }

  const handleSwapHook = async (newHook: string) => {
    setEditedHook(newHook)
    if (!activePost) return
    setIsSaving(true)
    try {
      await updateDraft(activePost.id, { hook: newHook })
      setPosts((prev) =>
        prev.map((p) => (p.id === activePost.id ? { ...p, hook: newHook } : p))
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveEdits = async () => {
    if (!activePost) return
    setIsSaving(true)
    try {
      await updateDraft(activePost.id, {
        hook: editedHook,
        body: editedBody,
        firstComment: editedComment
      })
      setPosts((prev) =>
        prev.map((p) =>
          p.id === activePost.id
            ? {
                ...p,
                hook: editedHook,
                body: editedBody,
                firstComment: editedComment,
                charCount: `${editedHook}\n\n${editedBody}`.length
              }
            : p
        )
      )
      setIsEditing(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCopyPost = () => {
    if (!activePost) return
    const tagsString = (activePost.hashtags || [])
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      .join(' ')
    const fullContent = `${editedHook}\n\n${editedBody}${activePost.cta ? `\n\n${activePost.cta}` : ''}${tagsString ? `\n\n${tagsString}` : ''}`

    navigator.clipboard.writeText(fullContent)
    setCopiedPost(true)
    setTimeout(() => setCopiedPost(false), 2500)
  }

  const handleCopyComment = () => {
    if (!editedComment) return
    navigator.clipboard.writeText(editedComment)
    setCopiedComment(true)
    setTimeout(() => setCopiedComment(false), 2500)
  }

  const handleApprove = async () => {
    if (!activePost) return
    setIsSaving(true)
    try {
      await approveDraft(activePost.id)
      setPosts((prev) =>
        prev.map((p) => (p.id === activePost.id ? { ...p, status: 'approved' } : p))
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleReject = async () => {
    if (!activePost) return
    const reason = prompt('Rejection reason (shapes future generations):')
    setIsSaving(true)
    try {
      await rejectDraft(activePost.id, reason || undefined)
      setPosts((prev) =>
        prev.map((p) => (p.id === activePost.id ? { ...p, status: 'rejected' } : p))
      )
    } finally {
      setIsSaving(false)
    }
  }

  const authorInitials = activePost?.accountName
    ? activePost.accountName
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'IN'

  const alternateHooks = activePost?.variants?.filter((v) => v.variantType === 'hook') || []

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <PageHeader
        title="Review & Ship Posts"
        badge="Daily Surface"
        description="Final polish before publishing. Review formatting, media, and platform-specific nuances."
        bottomContent={
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-muted" />
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none focus:border-accent"
            >
              <option value="all">All Identities</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="max-w-7xl mx-auto space-y-6">

      {filteredPosts.length === 0 || !activePost ? (
        <div className="p-16 text-center rounded-2xl border-2 border-dashed border-border bg-surface">
          <FileCheck className="w-10 h-10 text-muted mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No drafted posts waiting for review</h3>
          <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
            Approve concepts from the Idea Gate to draft grounded posts.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Post Selection & LinkedIn Preview */}
          <div className="lg:col-span-7 space-y-6">
            {/* Quick Post Switcher if multiple */}
            {filteredPosts.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {filteredPosts.map((p, idx) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPost(p)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium shrink-0 transition-colors cursor-pointer border ${
                      p.id === activePost?.id
                        ? 'bg-accent text-background border-accent shadow-xs'
                        : 'bg-surface border-border text-muted hover:text-foreground'
                    }`}
                  >
                    <span>Post #{idx + 1}</span>
                    <span className="text-[10px] opacity-80">({p.accountName})</span>
                  </button>
                ))}
              </div>
            )}

            {/* Alternate Hooks Bar (Above Preview) */}
            {alternateHooks.length > 0 && (
              <div className="rounded-xl border border-border bg-surface p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-accent" />
                    Alternate Hooks (Click to swap):
                  </span>
                  <span className="text-[11px] font-mono text-muted">
                    {editedHook.length} chars
                  </span>
                </div>
                <div className="grid gap-2">
                  {alternateHooks.map((alt) => (
                    <button
                      key={alt.id}
                      type="button"
                      onClick={() => handleSwapHook(alt.content)}
                      className={`text-left p-2.5 rounded-lg border text-xs transition-all ${
                        editedHook === alt.content
                          ? 'border-accent bg-accent/10 font-medium text-foreground'
                          : 'border-border hover:bg-surface-hover text-muted'
                      }`}
                    >
                      <span className="font-mono text-[10px] text-accent mr-1.5 uppercase">
                        Swap:
                      </span>
                      &quot;{alt.content}&quot;
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* In-place text editor or standard preview */}
            {isEditing ? (
              <div className="rounded-2xl border border-border bg-surface p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">Edit Draft Copy</span>
                  <span className="text-xs font-mono text-muted">
                    Hook: {editedHook.length} chars (fold ~200)
                  </span>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Opening Hook
                  </label>
                  <textarea
                    value={editedHook}
                    onChange={(e) => setEditedHook(e.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-border bg-surface-hover p-3 text-xs text-foreground focus:border-accent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Body
                  </label>
                  <textarea
                    value={editedBody}
                    onChange={(e) => setEditedBody(e.target.value)}
                    rows={8}
                    className="w-full rounded-xl border border-border bg-surface-hover p-3 text-xs text-foreground focus:border-accent outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    First Comment
                  </label>
                  <textarea
                    value={editedComment}
                    onChange={(e) => setEditedComment(e.target.value)}
                    rows={2}
                    className="w-full rounded-xl border border-border bg-surface-hover p-3 text-xs text-foreground focus:border-accent outline-none"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1.5 text-xs text-muted hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdits}
                    disabled={isSaving}
                    className="px-4 py-2 rounded-lg bg-accent text-background text-xs font-semibold"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-center">
                <LinkedInPreview
                  authorName={activePost.accountName}
                  authorHeadline={activePost.accountHeadline}
                  authorInitials={authorInitials}
                  hook={editedHook}
                  body={editedBody}
                  cta={activePost.cta}
                  hashtags={activePost.hashtags}
                  mediaUrl={activePost.media?.imageUrl}
                  mediaAltText={activePost.media?.altText}
                  foldCharLimit={200}
                />
              </div>
            )}
          </div>

          {/* Right Column: Citations, Media, Linting & First Comment */}
          <div className="lg:col-span-5 space-y-6">
            {/* Action Bar */}
            <div className="rounded-2xl border border-border bg-surface p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${
                    activePost.status === 'approved'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600'
                      : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600'
                  }`}>
                    {activePost.status}
                  </span>
                  <span className="text-xs text-muted font-mono">
                    {activePost.charCount} chars
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditing(!isEditing)}
                  className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline font-medium"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>{isEditing ? 'Preview' : 'Edit Text'}</span>
                </button>
              </div>

              {/* Primary Copy Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCopyPost}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-background text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  {copiedPost ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedPost ? 'Copied Post!' : 'Copy Post'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyComment}
                  disabled={!editedComment}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-surface-hover text-foreground text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {copiedComment ? <Check className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                  <span>{copiedComment ? 'Copied Comment!' : 'Copy Comment'}</span>
                </button>
              </div>

              {/* Approve / Reject */}
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={handleReject}
                  className="text-xs text-muted hover:text-rose-600 transition-colors"
                >
                  Reject with Reason
                </button>
                {activePost.status !== 'approved' && (
                  <button
                    type="button"
                    onClick={handleApprove}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Approve Post</span>
                  </button>
                )}
              </div>
            </div>

            {/* First Comment Box */}
            {editedComment && (
              <div className="rounded-2xl border border-border bg-surface p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-[#0a66c2]" />
                    First Comment (External Link Strategy)
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyComment}
                    className="text-[11px] text-accent hover:underline"
                  >
                    {copiedComment ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-muted bg-surface-hover p-3 rounded-xl break-words font-mono">
                  {editedComment}
                </p>
              </div>
            )}

            {/* Visual Media Attachment Card */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
                  <ImageIcon className="h-4 w-4 text-[var(--accent)]" />
                  Visual Media Attachment
                </span>
                {activePost.media?.imageUrl ? (
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--foreground)] capitalize">
                      {activePost.media.mode === 'ai_generated'
                        ? 'AI Visual'
                        : 'Stock Photo'}
                    </span>
                    {activePost.media.fallbackApplied && (
                      <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        Fallback Applied
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
                    Text Only
                  </span>
                )}
              </div>

              {mediaError && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-600 dark:text-red-400">
                  <span>{mediaError}</span>
                  <button
                    type="button"
                    onClick={() => setMediaError(null)}
                    className="p-1 hover:text-red-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {isMediaLoading ? (
                <div className="flex flex-col items-center justify-center space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)]/60 py-8 text-xs text-[var(--muted)] animate-pulse">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
                  <p className="font-medium text-[var(--foreground)]">
                    {mediaLoadingText || 'Processing media...'}
                  </p>
                  <p className="text-[11px] text-[var(--muted)]">
                    AI generation with automated fallback
                  </p>
                </div>
              ) : activePost.media?.imageUrl ? (
                <div className="space-y-3">
                  <div className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-neutral-900">
                    <img
                      src={activePost.media.imageUrl}
                      alt={activePost.media.altText || 'Post attachment'}
                      className="h-36 w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/70 via-transparent to-transparent p-2.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <p className="line-clamp-2 text-[11px] leading-tight text-white">
                        {activePost.media.promptOrQuery || activePost.media.altText}
                      </p>
                    </div>
                  </div>

                  {activePost.media.promptOrQuery && (
                    <p className="line-clamp-2 rounded-lg bg-[var(--surface-hover)] p-2 font-mono text-[11px] leading-relaxed text-[var(--muted)]">
                      {activePost.media.promptOrQuery}
                    </p>
                  )}

                  {/* Actions for existing image */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isMediaLoading}
                      onClick={handleRegenerateAIMedia}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                      <span>Regenerate AI</span>
                    </button>

                    <button
                      type="button"
                      disabled={isMediaLoading}
                      onClick={() => {
                        setShowStockInput(!showStockInput)
                        setShowCustomUrlInput(false)
                      }}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <Search className="h-3.5 w-3.5 text-blue-500" />
                      <span>Find Stock</span>
                    </button>

                    <button
                      type="button"
                      disabled={isMediaLoading}
                      onClick={() => {
                        setShowCustomUrlInput(!showCustomUrlInput)
                        setShowStockInput(false)
                      }}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <Edit2 className="h-3.5 w-3.5 text-emerald-500" />
                      <span>Custom URL</span>
                    </button>

                    <button
                      type="button"
                      disabled={isMediaLoading}
                      onClick={handleRemoveMedia}
                      className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
                      title="Remove media (Switch to Text Only)"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Text Only</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-hover)]/30 p-4 text-center">
                    <p className="text-xs text-[var(--muted)]">
                      This post is currently <strong>Text Only</strong> (no image attached).
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isMediaLoading}
                      onClick={handleRegenerateAIMedia}
                      className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Generate AI Image</span>
                    </button>

                    <button
                      type="button"
                      disabled={isMediaLoading}
                      onClick={() => {
                        setShowStockInput(!showStockInput)
                        setShowCustomUrlInput(false)
                      }}
                      className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <Search className="h-3.5 w-3.5 text-blue-500" />
                      <span>Find Stock Photo</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Collapsible Stock Search Input */}
              {showStockInput && !isMediaLoading && (
                <div className="animate-in fade-in space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-3 duration-150">
                  <label className="block text-[11px] font-semibold text-[var(--foreground)]">
                    Search Stock Imagery
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={stockSearchQuery}
                      onChange={e => setStockSearchQuery(e.target.value)}
                      placeholder={`e.g. ${activePost.hook.slice(0, 35)}...`}
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--foreground)]"
                      onKeyDown={e => e.key === 'Enter' && handleSearchStockMedia()}
                    />
                    <button
                      type="button"
                      onClick={handleSearchStockMedia}
                      className="cursor-pointer rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
                    >
                      Search
                    </button>
                  </div>
                </div>
              )}

              {/* Collapsible Custom URL Input */}
              {showCustomUrlInput && !isMediaLoading && (
                <div className="animate-in fade-in space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-3 duration-150">
                  <label className="block text-[11px] font-semibold text-[var(--foreground)]">
                    Direct Image URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={customImageUrl}
                      onChange={e => setCustomImageUrl(e.target.value)}
                      placeholder="https://images.unsplash.com/..."
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--foreground)]"
                      onKeyDown={e => e.key === 'Enter' && handleApplyCustomUrl()}
                    />
                    <button
                      type="button"
                      onClick={handleApplyCustomUrl}
                      className="cursor-pointer rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Citations Drawer */}
            {activePost.citations && activePost.citations.length > 0 && (
              <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Quote className="w-3.5 h-3.5 text-emerald-500" />
                  Grounded Citations ({activePost.citations.length})
                </span>
                <div className="space-y-2">
                  {activePost.citations.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 rounded-xl border border-border bg-surface-hover text-xs space-y-1"
                    >
                      <p className="font-medium text-foreground">{c.claim}</p>
                      {c.quote && (
                        <p className="text-[11px] text-muted italic">
                          &quot;{c.quote}&quot;
                        </p>
                      )}
                      {c.sourceUrl && (
                        <a
                          href={c.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline pt-1"
                        >
                          <span>{c.sourceTitle || 'View Source'}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Deterministic Linter Findings */}
            {activePost.lintFindings && activePost.lintFindings.length > 0 && (
              <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <FileCheck className="w-3.5 h-3.5 text-accent" />
                  Deterministic Lint Findings
                </span>
                <div className="divide-y divide-border text-xs">
                  {activePost.lintFindings.map((finding, idx) => (
                    <div key={idx} className="py-2.5 flex items-start gap-2.5">
                      {finding.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : finding.severity === 'error' ? (
                        <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-muted block">
                          {finding.rule}
                        </span>
                        <p className="text-xs text-foreground mt-0.5">
                          {finding.message}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
      </div>
    </div>
  )
}
