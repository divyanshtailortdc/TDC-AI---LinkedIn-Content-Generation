'use client'

import { ConfirmPopover } from '@/components/confirm-popover'
import { PlatformMark } from '@/components/platform-mark'
import { showToast } from '@/components/toast-notification'
import { formatAbsoluteDate, formatRelativeDate } from '@/lib/format-date'
import { PLATFORMS, type PlatformId } from '@/lib/formats'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import {
  hashtagsFromText,
  INSIGHT_LIMITS,
  isAnalyzablePlatform,
  linesFromPairs,
  pairsFromLines,
  type InsightPost,
  type ProfileInsights,
  type ProfileInsightView
} from '@/lib/profile-insights/types'
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  X
} from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  getProfileInsights,
  refreshProfileInsights,
  saveProfileInsights
} from './profile-insights-actions'

/**
 * What each profile link on the Profile page shows about how the identity
 * posts on that platform (src/lib/profile-insights): a line under the link
 * while it is analyzed and once it is, and a window to read, edit and
 * refresh it. Saving a new link starts its analysis on the server; this
 * follows it until it ends.
 */

/** How often a running analysis is checked on. */
const POLL_MS = 4000

const labelOf = (platform: PlatformId) => PLATFORMS[platform].label

/** Says how an analysis that was running has ended, wherever the user is on the page. */
function announce(view: ProfileInsightView) {
  const label = labelOf(view.platform)
  if (view.status === 'ready') {
    showToast({
      type: 'success',
      title: `${label} profile analyzed`,
      message: `New ideas and ${label} posts will follow how you post there.`
    })
  } else {
    showToast({
      type: 'error',
      title: `${label} profile not analyzed`,
      message: view.error ?? undefined,
      duration: 8000
    })
  }
}

/**
 * The identity's analyses, kept current: while any is running it is checked
 * on every few seconds, and a toast says how each one ended.
 */
export function useProfileInsights(
  accountId: string,
  initial: ProfileInsightView[]
) {
  const [views, setViews] = useState(initial)
  const current = useRef(initial)

  const apply = useCallback((next: ProfileInsightView[]) => {
    for (const view of next) {
      const before = current.current.find(v => v.platform === view.platform)
      if (before?.status === 'analyzing' && view.status !== 'analyzing')
        announce(view)
    }
    current.current = next
    setViews(next)
  }, [])

  const analyzing = views.some(v => v.status === 'analyzing')
  useEffect(() => {
    if (!analyzing) return
    let stopped = false
    const timer = setInterval(async () => {
      const res = await getProfileInsights(accountId)
      if (!stopped && res.success) apply(res.views)
    }, POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [accountId, analyzing, apply])

  const refresh = async (platform: PlatformId): Promise<boolean> => {
    const res = await refreshProfileInsights(accountId, platform)
    if (!res.success) {
      showToast({
        type: 'error',
        title: 'Could not start the analysis',
        message: res.error
      })
      return false
    }
    apply(res.views)
    return true
  }

  const save = async (
    platform: PlatformId,
    insights: ProfileInsights
  ): Promise<boolean> => {
    const res = await saveProfileInsights(accountId, platform, insights)
    if (!res.success) {
      showToast({
        type: 'error',
        title: 'Could not save your changes',
        message: res.error
      })
      return false
    }
    apply(res.views)
    showToast({
      type: 'success',
      title: 'Saved',
      message: `${labelOf(platform)} posts will follow your version.`
    })
    return true
  }

  return {
    viewOf: (platform: PlatformId) => views.find(v => v.platform === platform),
    refresh,
    save
  }
}

type InsightsApi = ReturnType<typeof useProfileInsights>

const linkButton =
  'text-accent hover:text-accent-hover inline-flex items-center gap-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50'

/** How many posts an analysis read, or that the user wrote it themselves. */
function basisOf(view: ProfileInsightView): string {
  const n = view.posts.length
  if (n === 0) return 'Described by you'
  return `Learned from ${n} post${n === 1 ? '' : 's'}`
}

/** "Refresh", asking first when it would replace the user's edits. */
function RefreshButton({
  edited,
  disabled,
  onRefresh,
  children
}: {
  edited: boolean
  disabled: boolean
  onRefresh: () => Promise<unknown>
  children: React.ReactNode
}) {
  const button = (
    <button
      type="button"
      disabled={disabled}
      onClick={edited ? undefined : () => void onRefresh()}
      className={linkButton}
    >
      {children}
    </button>
  )
  if (!edited) return button
  return (
    <ConfirmPopover
      title="Analyze your posts again?"
      description="A new analysis replaces the changes you made to this one."
      confirmLabel="Analyze again"
      tone="neutral"
      onConfirm={async () => {
        await onRefresh()
      }}
      disabled={disabled}
    >
      {button}
    </ConfirmPopover>
  )
}

/**
 * The line under a profile link: what its analysis says, or that one is
 * running, or why there is none, with what can be done about it.
 */
export function ProfileInsightRow({
  platform,
  savedLink,
  typedLink,
  editing,
  api
}: {
  platform: PlatformId
  /** The link saved for this platform; its analysis is what is shown. */
  savedLink: string
  /** What the field holds now. */
  typedLink: string
  editing: boolean
  api: InsightsApi
}) {
  const mounted = useHasMounted()
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<'view' | 'edit' | null>(null)
  if (!isAnalyzablePlatform(platform)) return null
  const label = labelOf(platform)

  // A link typed but not saved yet: it is analyzed once saved.
  if (typedLink.trim() !== savedLink.trim()) {
    return editing && typedLink.trim() ? (
      <p className="text-muted text-[11px] leading-relaxed">
        Once saved, your public {label} posts are read to learn how you post
        there.
      </p>
    ) : null
  }
  if (!savedLink.trim()) return null

  const view = api.viewOf(platform)
  const refresh = async () => {
    setBusy(true)
    await api.refresh(platform)
    setBusy(false)
  }
  const windowFor = view && dialog && (
    <ProfileInsightsDialog
      view={view}
      initialMode={dialog}
      onClose={() => setDialog(null)}
      onSave={insights => api.save(platform, insights)}
      onRefresh={async () => {
        const ok = await api.refresh(platform)
        if (ok) setDialog(null)
        return ok
      }}
    />
  )

  if (!view) {
    return (
      <p className="text-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span>Not analyzed yet.</span>
        <button
          type="button"
          disabled={busy}
          onClick={refresh}
          className={linkButton}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          Learn from my {label} posts
        </button>
      </p>
    )
  }

  if (view.status === 'analyzing') {
    return (
      <p
        role="status"
        className="text-muted flex items-center gap-1.5 text-[11px]"
      >
        <Loader2 className="text-accent h-3 w-3 shrink-0 animate-spin" />
        Reading your public {label} posts… this takes a minute or two.
      </p>
    )
  }

  if (view.insights) {
    const latestFailed = view.status !== 'ready' && view.error
    return (
      <div className="space-y-1">
        <p className="text-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <Sparkles className="text-accent h-3 w-3 shrink-0" />
          <span>
            {basisOf(view)}
            {mounted && view.analyzedAt && view.posts.length > 0
              ? ` · ${formatRelativeDate(view.analyzedAt)}`
              : ''}
            {view.editedAt && view.posts.length > 0 ? ' · edited' : ''}
          </span>
          <button
            type="button"
            onClick={() => setDialog('view')}
            className={linkButton}
          >
            View
          </button>
          <RefreshButton
            edited={Boolean(view.editedAt)}
            disabled={busy}
            onRefresh={refresh}
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Refresh
          </RefreshButton>
        </p>
        {latestFailed && (
          <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
            The latest refresh did not finish: {view.error} The analysis above
            is still used.
          </p>
        )}
        {windowFor}
      </div>
    )
  }

  // Nothing learned: say why, and what can be done instead.
  return (
    <div
      role="status"
      className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300"
    >
      <p className="flex gap-1.5">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          {view.error ?? `Your ${label} posts could not be analyzed.`}
        </span>
      </p>
      <p className="flex flex-wrap gap-x-3 gap-y-1 pl-4.5">
        <button
          type="button"
          disabled={busy}
          onClick={refresh}
          className={linkButton}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Try again
        </button>
        <button
          type="button"
          onClick={() => setDialog('edit')}
          className={linkButton}
        >
          <Pencil className="h-3 w-3" />
          Describe it yourself
        </button>
      </p>
      {windowFor}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

/** The insights as the editor holds them: lists as lines of text. */
type Draft = {
  summary: string
  themes: string
  writingStyle: string
  tone: string
  captions: string
  hashtags: string
  hashtagUsage: string
  visualIdentity: string
  formats: string
}

const toDraft = (i: ProfileInsights | null): Draft => ({
  summary: i?.summary ?? '',
  themes: linesFromPairs(
    (i?.themes ?? []).map(t => ({ name: t.name, detail: t.description }))
  ),
  writingStyle: i?.writingStyle ?? '',
  tone: i?.tone ?? '',
  captions: i?.captions ?? '',
  hashtags: (i?.hashtags ?? []).join(' '),
  hashtagUsage: i?.hashtagUsage ?? '',
  visualIdentity: i?.visualIdentity ?? '',
  formats: linesFromPairs(
    (i?.formats ?? []).map(f => ({ name: f.format, detail: f.note }))
  )
})

const fromDraft = (d: Draft): ProfileInsights => ({
  summary: d.summary,
  themes: pairsFromLines(d.themes).map(p => ({
    name: p.name,
    description: p.detail
  })),
  writingStyle: d.writingStyle,
  tone: d.tone,
  captions: d.captions,
  hashtags: hashtagsFromText(d.hashtags),
  hashtagUsage: d.hashtagUsage,
  visualIdentity: d.visualIdentity,
  formats: pairsFromLines(d.formats).map(p => ({
    format: p.name,
    note: p.detail
  }))
})

const inputClass =
  'border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm leading-relaxed'

/** One editable part of the insights. */
const FIELDS: Array<{
  key: keyof Draft
  label: string
  hint?: string
  rows: number
  max?: number
}> = [
  { key: 'summary', label: 'In short', rows: 3, max: INSIGHT_LIMITS.summary },
  {
    key: 'themes',
    label: 'What you post about',
    hint: 'One per line, as "Subject: what you say about it".',
    rows: 5
  },
  {
    key: 'writingStyle',
    label: 'How you write',
    rows: 5,
    max: INSIGHT_LIMITS.writingStyle
  },
  { key: 'tone', label: 'Tone', rows: 2, max: INSIGHT_LIMITS.tone },
  { key: 'captions', label: 'Captions', rows: 3, max: INSIGHT_LIMITS.captions },
  {
    key: 'hashtags',
    label: 'Your hashtags',
    hint: 'Separated by spaces.',
    rows: 2
  },
  {
    key: 'hashtagUsage',
    label: 'How you use hashtags',
    rows: 2,
    max: INSIGHT_LIMITS.hashtagUsage
  },
  {
    key: 'visualIdentity',
    label: 'How your posts look',
    hint: 'Used for the images made for your posts here.',
    rows: 3,
    max: INSIGHT_LIMITS.visualIdentity
  },
  {
    key: 'formats',
    label: 'Kinds of post',
    hint: 'One per line, as "Kind: what you use it for".',
    rows: 3
  }
]

function Part({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-1">
      <h3 className="text-foreground text-xs font-semibold">{title}</h3>
      <div className="text-muted text-sm leading-relaxed">{children}</div>
    </section>
  )
}

function InsightsView({ insights }: { insights: ProfileInsights }) {
  return (
    <div className="space-y-4">
      {insights.summary && <Part title="In short">{insights.summary}</Part>}
      {insights.themes.length > 0 && (
        <Part title="What you post about">
          <ul className="list-disc space-y-1 pl-4">
            {insights.themes.map(t => (
              <li key={t.name}>
                <span className="text-foreground font-medium">{t.name}</span>
                {t.description && ` — ${t.description}`}
              </li>
            ))}
          </ul>
        </Part>
      )}
      {insights.writingStyle && (
        <Part title="How you write">{insights.writingStyle}</Part>
      )}
      {insights.tone && <Part title="Tone">{insights.tone}</Part>}
      {insights.captions && <Part title="Captions">{insights.captions}</Part>}
      {(insights.hashtags.length > 0 || insights.hashtagUsage) && (
        <Part title="Hashtags">
          {insights.hashtags.length > 0 && (
            <span className="mb-1.5 flex flex-wrap gap-1.5">
              {insights.hashtags.map(tag => (
                <span
                  key={tag}
                  className="border-border text-foreground rounded-full border px-2 py-0.5 text-xs"
                >
                  {tag}
                </span>
              ))}
            </span>
          )}
          {insights.hashtagUsage}
        </Part>
      )}
      <Part title="How your posts look">
        {insights.visualIdentity ||
          'Not known: no images from your posts could be seen.'}
      </Part>
      {insights.formats.length > 0 && (
        <Part title="Kinds of post">
          <ul className="list-disc space-y-1 pl-4">
            {insights.formats.map(f => (
              <li key={f.format}>
                <span className="text-foreground font-medium">{f.format}</span>
                {f.note && ` — ${f.note}`}
              </li>
            ))}
          </ul>
        </Part>
      )}
    </div>
  )
}

/** Where an analysis's posts came from, and that the platform itself was not read. */
function sourcesLine(view: ProfileInsightView): string {
  const label = labelOf(view.platform)
  const search = view.sources.search ?? 0
  const buffer = view.sources.buffer ?? 0
  const parts = [
    search > 0 &&
      `${search} public post${search === 1 ? '' : 's'} as search engines show them (often only the opening)`,
    buffer > 0 &&
      `${buffer} post${buffer === 1 ? '' : 's'} you sent through Buffer`
  ].filter(Boolean)
  const images = view.sources.images ?? 0
  return `Read from ${parts.join(' and ')}${images > 0 ? `, with ${images} of their images` : ''}. Nothing is read from ${label} itself, and new posts never copy yours.`
}

function PostList({ posts }: { posts: InsightPost[] }) {
  const mounted = useHasMounted()
  return (
    <details className="border-border rounded-lg border">
      <summary className="text-foreground cursor-pointer px-3 py-2 text-xs font-medium">
        Posts this was learned from ({posts.length})
      </summary>
      <ul className="divide-border max-h-72 divide-y overflow-y-auto">
        {posts.map(post => (
          <li key={post.url} className="space-y-1 px-3 py-2">
            <p className="text-muted text-[11px]">
              {[
                mounted && post.date ? formatAbsoluteDate(post.date) : null,
                post.kind,
                post.aspect,
                post.source === 'buffer' ? 'sent through Buffer' : 'public',
                post.partial ? 'opening only' : null,
                post.wordsOnly ? 'words only' : null
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="text-foreground line-clamp-3 text-xs leading-relaxed">
              {post.text || '(no text could be read)'}
            </p>
            {post.url.startsWith('https://') && (
              <a
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                className={linkButton}
              >
                Open <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

function ProfileInsightsDialog({
  view,
  initialMode,
  onClose,
  onSave,
  onRefresh
}: {
  view: ProfileInsightView
  initialMode: 'view' | 'edit'
  onClose: () => void
  onSave: (insights: ProfileInsights) => Promise<boolean>
  onRefresh: () => Promise<boolean>
}) {
  const titleId = useId()
  const mounted = useHasMounted()
  const label = labelOf(view.platform)
  const [mode, setMode] = useState<'view' | 'edit'>(
    view.insights ? initialMode : 'edit'
  )
  const [draft, setDraft] = useState<Draft>(() => toDraft(view.insights))
  const [busy, setBusy] = useState<'save' | 'refresh' | null>(null)
  const analyzing = view.status === 'analyzing'

  // Modal: the page's own shortcuts must not act on its keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onClose])

  const save = async () => {
    setBusy('save')
    const ok = await onSave(fromDraft(draft))
    setBusy(null)
    if (ok) setMode('view')
  }

  const cancelEdit = () => {
    if (!view.insights) return onClose()
    setDraft(toDraft(view.insights))
    setMode('view')
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={e => {
        if (e.target === e.currentTarget && !busy && mode === 'view') onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="border-border bg-surface flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col rounded-2xl border shadow-xl"
      >
        <header className="border-border flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-foreground flex items-center gap-2 text-base font-semibold"
            >
              <PlatformMark platform={view.platform} className="h-4 w-4" />
              How you post on {label}
            </h2>
            <p className="text-muted mt-0.5 truncate text-xs">
              <a
                href={view.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground"
              >
                {view.profileUrl}
              </a>
              {mounted && view.analyzedAt && view.posts.length > 0
                ? ` · analyzed ${formatAbsoluteDate(view.analyzedAt)}`
                : ''}
              {view.editedAt ? ' · edited by you' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            aria-label="Close"
            className="text-muted hover:text-foreground rounded-md p-1 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {mode === 'view' && view.insights ? (
            <>
              <InsightsView insights={view.insights} />
              {view.posts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-muted text-[11px] leading-relaxed">
                    {sourcesLine(view)}
                  </p>
                  <PostList posts={view.posts} />
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-muted text-xs leading-relaxed">
                Ideas, {label} posts and their images follow what is written
                here. Leave out anything you are not sure of.
              </p>
              {FIELDS.map(field => (
                <div key={field.key}>
                  <label
                    htmlFor={`${titleId}-${field.key}`}
                    className="text-foreground mb-1 block text-xs font-medium"
                  >
                    {field.label}
                    {field.hint && (
                      <span className="text-muted ml-1.5 font-normal">
                        {field.hint}
                      </span>
                    )}
                  </label>
                  <textarea
                    id={`${titleId}-${field.key}`}
                    autoComplete="off"
                    rows={field.rows}
                    maxLength={field.max}
                    value={draft[field.key]}
                    onChange={e =>
                      setDraft(d => ({ ...d, [field.key]: e.target.value }))
                    }
                    className={`${inputClass} resize-y`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
          {mode === 'view' ? (
            <>
              <RefreshButton
                edited={Boolean(view.editedAt)}
                disabled={busy !== null || analyzing}
                onRefresh={async () => {
                  setBusy('refresh')
                  await onRefresh()
                  setBusy(null)
                }}
              >
                {busy === 'refresh' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {analyzing ? 'Being analyzed…' : 'Analyze my posts again'}
              </RefreshButton>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('edit')}
                  disabled={busy !== null || analyzing}
                  className="border-border text-foreground hover:bg-surface-hover inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium disabled:opacity-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="bg-accent hover:bg-accent-hover text-background inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="text-muted text-[11px]">
                {view.posts.length > 0 &&
                  'Analyzing again replaces your changes.'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={busy !== null}
                  className="border-border text-foreground hover:bg-surface-hover inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={busy !== null}
                  className="bg-accent hover:bg-accent-hover text-background inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:opacity-50"
                >
                  {busy === 'save' && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  Save
                </button>
              </div>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body
  )
}
