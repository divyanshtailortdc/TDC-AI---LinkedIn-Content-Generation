'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Copy,
  Check,
  Edit2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  MessageSquare,
  FileCheck,
  Sparkles,
  Quote,
  Layers,
  ChevronRight,
  Filter
} from 'lucide-react'
import { LinkedInPreview } from '@/components/linkedin-preview'
import { updateDraft, approveDraft, rejectDraft } from './actions'
import type { LintFinding } from '~/lib/lint/run-linter'

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
  citations: Array<{ id: string; claim: string; quote?: string | null; sourceUrl?: string | null; sourceTitle?: string | null }>
  media?: { mode: string; imageUrl?: string | null; altText?: string | null; promptOrQuery?: string | null } | null
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
    <div className="p-6 sm:p-8 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
              Review &amp; Ship Posts
            </h1>
            <span className="rounded-full bg-[var(--accent)]/10 text-[var(--accent)] px-2.5 py-0.5 text-xs font-semibold">
              Daily Surface
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">
            Pixel-accurate preview with the ~200-char fold line, citations, and instant copy-to-clipboard.
          </p>
        </div>

        {/* Identity Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-[var(--muted)]" />
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
          >
            <option value="all">All Personas ({posts.length})</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filteredPosts.length === 0 || !activePost ? (
        <div className="p-16 text-center rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)]">
          <FileCheck className="w-10 h-10 text-[var(--muted)] mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-[var(--foreground)]">No drafted posts waiting for review</h3>
          <p className="text-xs text-[var(--muted)] mt-1 max-w-sm mx-auto">
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
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-xs'
                        : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'
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
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--foreground)] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
                    Alternate Hooks (Click to swap):
                  </span>
                  <span className="text-[11px] font-mono text-[var(--muted)]">
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
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--foreground)]'
                          : 'border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--muted)]'
                      }`}
                    >
                      <span className="font-mono text-[10px] text-[var(--accent)] mr-1.5 uppercase">
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
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--foreground)]">Edit Draft Copy</span>
                  <span className="text-xs font-mono text-[var(--muted)]">
                    Hook: {editedHook.length} chars (fold ~200)
                  </span>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                    Opening Hook
                  </label>
                  <textarea
                    value={editedHook}
                    onChange={(e) => setEditedHook(e.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-3 text-xs text-[var(--foreground)] focus:border-[var(--accent)] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                    Body
                  </label>
                  <textarea
                    value={editedBody}
                    onChange={(e) => setEditedBody(e.target.value)}
                    rows={8}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-3 text-xs text-[var(--foreground)] focus:border-[var(--accent)] outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                    First Comment
                  </label>
                  <textarea
                    value={editedComment}
                    onChange={(e) => setEditedComment(e.target.value)}
                    rows={2}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-3 text-xs text-[var(--foreground)] focus:border-[var(--accent)] outline-none"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdits}
                    disabled={isSaving}
                    className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold"
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
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${
                    activePost.status === 'approved'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600'
                      : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600'
                  }`}>
                    {activePost.status}
                  </span>
                  <span className="text-xs text-[var(--muted)] font-mono">
                    {activePost.charCount} chars
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditing(!isEditing)}
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline font-medium"
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
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  {copiedPost ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedPost ? 'Copied Post!' : 'Copy Post'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyComment}
                  disabled={!editedComment}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--foreground)] text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {copiedComment ? <Check className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                  <span>{copiedComment ? 'Copied Comment!' : 'Copy Comment'}</span>
                </button>
              </div>

              {/* Approve / Reject */}
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={handleReject}
                  className="text-xs text-[var(--muted)] hover:text-rose-600 transition-colors"
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
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--foreground)] flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-[#0a66c2]" />
                    First Comment (External Link Strategy)
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyComment}
                    className="text-[11px] text-[var(--accent)] hover:underline"
                  >
                    {copiedComment ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-[var(--muted)] bg-[var(--surface-hover)] p-3 rounded-xl break-words font-mono">
                  {editedComment}
                </p>
              </div>
            )}

            {/* Citations Drawer */}
            {activePost.citations && activePost.citations.length > 0 && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3">
                <span className="text-xs font-semibold text-[var(--foreground)] flex items-center gap-1.5">
                  <Quote className="w-3.5 h-3.5 text-emerald-500" />
                  Grounded Citations ({activePost.citations.length})
                </span>
                <div className="space-y-2">
                  {activePost.citations.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] text-xs space-y-1"
                    >
                      <p className="font-medium text-[var(--foreground)]">{c.claim}</p>
                      {c.quote && (
                        <p className="text-[11px] text-[var(--muted)] italic">
                          &quot;{c.quote}&quot;
                        </p>
                      )}
                      {c.sourceUrl && (
                        <a
                          href={c.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline pt-1"
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
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3">
                <span className="text-xs font-semibold text-[var(--foreground)] flex items-center gap-1.5">
                  <FileCheck className="w-3.5 h-3.5 text-[var(--accent)]" />
                  Deterministic Lint Findings
                </span>
                <div className="divide-y divide-[var(--border)] text-xs">
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
                        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--muted)] block">
                          {finding.rule}
                        </span>
                        <p className="text-xs text-[var(--foreground)] mt-0.5">
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
  )
}
