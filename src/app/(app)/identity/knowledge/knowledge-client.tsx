'use client'

import { useStepView } from '@/components/account-setup/setup-frame'
import { ConfirmPopover } from '@/components/confirm-popover'
import { Pagination } from '@/components/pagination'
import {
  updateDraftSuggestions,
  useIdentitySetupDraft
} from '@/components/ai-setup/draft-store'
import { ProvenanceBadge } from '@/components/ai-setup/prefill-banner'
import { showToast } from '@/components/toast-notification'
import {
  EMPTY_SUGGESTIONS
} from '@/lib/ai/skills/profile-setup/schema'
import { PAGE_SIZE, paginate } from '@/lib/pagination'
import { normalizeUrlForCompare } from '@/lib/urls'
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Globe,
  Layers,
  Loader2,
  Quote,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  deleteKnowledgeDocument,
  fetchUrlPreview,
  saveKnowledgeDocument
} from './actions'

type KnowledgeDoc = {
  id: string
  title: string
  sourceType: string
  sourceUrl: string | null
  summary: string | null
  keyClaims: Array<{ claim: string; quote: string; confidence?: number }> | null
  wordCount?: number
  createdAt: Date | string
}

export function KnowledgeClient({
  accountId,
  accountName,
  initialDocs
}: {
  accountId: string
  accountName: string
  initialDocs: KnowledgeDoc[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'url' | 'artifact'>('url')

  // The document list, newest first, a page at a time. A document added by
  // any of the forms below lands at the top, so the list goes back to its
  // first page to show it. A page emptied by a deletion shows the last page.
  const [docPage, setDocPage] = useState(1)
  const newestDocId = initialDocs[0]?.id
  const [shownNewestDocId, setShownNewestDocId] = useState(newestDocId)
  if (newestDocId !== shownNewestDocId) {
    setShownNewestDocId(newestDocId)
    setDocPage(1)
  }
  const { rows: pageDocs, pageInfo: docPageInfo } = paginate(
    initialDocs,
    docPage,
    PAGE_SIZE
  )
  const docListRef = useRef<HTMLElement>(null)

  // URL state
  const [inputUrl, setInputUrl] = useState('')
  const [isFetchingUrl, setIsFetchingUrl] = useState(false)
  // The preview keeps the URL it was fetched from: the input can be edited, or
  // refilled by "Use this URL", after the fetch starts, and saving its value
  // stored one page's content under another page's URL.
  const [urlPreview, setUrlPreview] = useState<{
    url: string
    title: string
    content: string
    wordCount: number
  } | null>(null)

  // Artifact state
  const [artifactTitle, setArtifactTitle] = useState('')
  const [artifactContent, setArtifactContent] = useState('')

  // Action status
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null)

  // AI setup suggestions. Picking one only fills the inputs below; the normal
  // fetch, extract and save steps still run, and still need a click.
  const draft = useIdentitySetupDraft(accountId)
  const aiKnowledge = draft?.suggestions.knowledge
  const hasAiKnowledge = Boolean(
    aiKnowledge &&
      (aiKnowledge.sources.length > 0 ||
        aiKnowledge.facts.length > 0 ||
        aiKnowledge.suggestedAdditions.length > 0)
  )
  const savedUrls = new Set(
    initialDocs
      .map(d => d.sourceUrl)
      .filter((u): u is string => Boolean(u))
      .map(normalizeUrlForCompare)
  )
  // Facts alone are not an unsaved change: they have their own Save button.
  const hasPendingAiKnowledge = Boolean(
    aiKnowledge &&
      (aiKnowledge.sources.length > 0 ||
        aiKnowledge.suggestedAdditions.length > 0)
  )

  // A source that is already in the knowledge base is done: leaving it in the
  // draft would keep the step marked as having unsaved suggestions.
  const savedSourceKey = initialDocs
    .map(d => d.sourceUrl)
    .filter((u): u is string => Boolean(u))
    .map(normalizeUrlForCompare)
    .join('|')
  useEffect(() => {
    if (!aiKnowledge?.sources.some(s => s.url && savedUrls.has(normalizeUrlForCompare(s.url)))) return
    updateDraftSuggestions(accountId, s => ({
      ...s,
      knowledge: {
        ...s.knowledge,
        sources: s.knowledge.sources.filter(
          src => !src.url || !savedUrls.has(normalizeUrlForCompare(src.url))
        )
      }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- savedSourceKey stands for savedUrls
  }, [accountId, aiKnowledge, savedSourceKey])

  // Takes a suggestion off the draft once its document is saved.
  const clearSavedSuggestion = (saved: { url?: string; title?: string }) =>
    updateDraftSuggestions(accountId, s => ({
      ...s,
      knowledge: {
        ...s.knowledge,
        sources: s.knowledge.sources.filter(
          src =>
            !saved.url ||
            !src.url ||
            normalizeUrlForCompare(src.url) !== normalizeUrlForCompare(saved.url)
        ),
        suggestedAdditions: s.knowledge.suggestedAdditions.filter(
          addition =>
            !saved.title ||
            addition.split(':')[0]!.slice(0, 120).trim() !== saved.title.trim()
        )
      }
    }))

  // The facts the AI found, saved as one document so none are lost.
  const handleSaveFacts = async () => {
    if (!aiKnowledge || aiKnowledge.facts.length === 0) return
    setError(null)
    setIsSaving(true)
    try {
      await saveKnowledgeDocument({
        accountId,
        title: 'Facts from your AI setup',
        sourceType: 'artifact',
        content: aiKnowledge.facts
          .map(f => `${f.statement}\n"${f.quote}" (${f.source})`)
          .join('\n\n')
      })
      updateDraftSuggestions(accountId, s => ({
        ...s,
        knowledge: { ...s.knowledge, facts: [] }
      }))
      showToast({
        type: 'success',
        title: 'Facts Saved',
        message: 'The facts were saved to your knowledge base.'
      })
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to save facts')
      showToast({
        type: 'error',
        title: 'Save Failed',
        message: err.message || 'Failed to save facts'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleFetchUrl = async () => {
    if (!inputUrl.trim()) {
      showToast({
        type: 'error',
        title: 'URL Required',
        message: 'Please enter a webpage URL to fetch and extract.'
      })
      return
    }
    setError(null)
    setIsFetchingUrl(true)
    setUrlPreview(null)

    const url = inputUrl
    try {
      const res = await fetchUrlPreview(url)
      if (res.success && res.title && res.content) {
        setUrlPreview({
          url,
          title: res.title,
          content: res.content,
          wordCount: res.wordCount || res.content.split(/\s+/).length
        })
        showToast({
          type: 'success',
          title: 'Content Extracted',
          message: `Successfully extracted "${res.title}". Click save to add to knowledge base.`
        })
      } else {
        const errorMsg = res.error || 'Failed to fetch webpage content'
        setError(errorMsg)
        showToast({
          type: 'error',
          title: 'Fetch Failed',
          message: errorMsg
        })
      }
    } catch (err: any) {
      const errorMsg = err.message || 'An unexpected error occurred while fetching'
      setError(errorMsg)
      showToast({
        type: 'error',
        title: 'Fetch Error',
        message: errorMsg
      })
    } finally {
      setIsFetchingUrl(false)
    }
  }

  const handleSaveUrlDoc = async () => {
    if (!urlPreview) return
    setError(null)
    setIsSaving(true)
    try {
      await saveKnowledgeDocument({
        accountId,
        title: urlPreview.title,
        sourceType: 'url',
        sourceUrl: urlPreview.url,
        content: urlPreview.content
      })
      showToast({
        type: 'success',
        title: 'Document Saved',
        message: `"${urlPreview.title}" saved to knowledge base.`
      })
      clearSavedSuggestion({ url: urlPreview.url })
      setInputUrl('')
      setUrlPreview(null)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to save document')
      showToast({
        type: 'error',
        title: 'Save Failed',
        message: err.message || 'Failed to save document'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveArtifact = async () => {
    if (!artifactTitle.trim() || !artifactContent.trim()) {
      setError('Please provide both a title and artifact content.')
      showToast({
        type: 'error',
        title: 'Missing Fields',
        message: 'Please provide both a title and artifact content.'
      })
      return
    }
    setError(null)
    setIsSaving(true)
    try {
      await saveKnowledgeDocument({
        accountId,
        title: artifactTitle,
        sourceType: 'artifact',
        content: artifactContent
      })
      showToast({
        type: 'success',
        title: 'Artifact Saved',
        message: `"${artifactTitle.trim()}" saved to knowledge base.`
      })
      clearSavedSuggestion({ title: artifactTitle })
      setArtifactTitle('')
      setArtifactContent('')
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to save artifact')
      showToast({
        type: 'error',
        title: 'Save Failed',
        message: err.message || 'Failed to save artifact'
      })
    } finally {
      setIsSaving(false)
    }
  }

  // Confirmed by the ConfirmPopover around the delete button.
  const handleDelete = async (docId: string) => {
    setDeletingId(docId)
    try {
      await deleteKnowledgeDocument(docId, accountId)
      showToast({
        type: 'info',
        title: 'Document Removed',
        message: 'Document removed from knowledge base.'
      })
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to delete document')
      showToast({
        type: 'error',
        title: 'Delete Failed',
        message: err.message || 'Failed to delete document'
      })
    } finally {
      setDeletingId(null)
    }
  }

  // A saved knowledge base is read-only until the header's Edit; Cancel clears
  // whatever was typed. Suggestions from the AI setup keep the step open.
  const editing = useStepView({
    dirty: hasPendingAiKnowledge,
    onCancel: () => {
      setInputUrl('')
      setUrlPreview(null)
      setArtifactTitle('')
      setArtifactContent('')
      setError(null)
    }
  })

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {hasAiKnowledge && aiKnowledge && (
        <section className="border-accent/30 bg-accent/5 space-y-4 rounded-xl border p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Sparkles className="text-accent mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <h2 className="text-foreground text-sm font-semibold">
                  Suggested from your AI setup
                </h2>
                <p className="text-muted mt-0.5 text-xs">
                  Sources are pages you mentioned or that web search found and
                  checked to be about you, and facts were checked against their
                  source text. Nothing is added until you save it.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                updateDraftSuggestions(accountId, s => ({
                  ...s,
                  knowledge: EMPTY_SUGGESTIONS.knowledge
                }))
              }
              className="text-muted hover:text-foreground inline-flex items-center gap-1 text-xs"
            >
              <X className="h-3.5 w-3.5" />
              Dismiss
            </button>
          </div>

          {aiKnowledge.sources.length > 0 && (
            <ul className="space-y-2">
              {aiKnowledge.sources.map(source => {
                const already =
                  source.url && savedUrls.has(normalizeUrlForCompare(source.url))
                return (
                  <li
                    key={`${source.title}-${source.url}`}
                    className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-foreground font-medium">{source.title}</p>
                      <p className="text-muted">
                        {source.official && 'Your official site · '}
                        {source.url} · {source.reason}
                      </p>
                    </div>
                    {source.url && (
                      <button
                        type="button"
                        disabled={Boolean(already)}
                        onClick={() => {
                          setTab('url')
                          setInputUrl(source.url!)
                          setUrlPreview(null)
                        }}
                        className="border-border text-foreground hover:bg-surface-hover h-7 shrink-0 rounded-lg border px-2.5 font-medium disabled:opacity-50"
                      >
                        {already ? 'Already added' : 'Use this URL'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {aiKnowledge.facts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-foreground text-xs font-semibold">Facts found</p>
                <button
                  type="button"
                  onClick={handleSaveFacts}
                  disabled={isSaving}
                  className="text-accent shrink-0 text-xs font-medium hover:underline disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : 'Save facts to knowledge base'}
                </button>
              </div>
              {aiKnowledge.facts.map(fact => (
                <div key={fact.quote} className="bg-surface rounded-lg p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-foreground font-medium">{fact.statement}</span>
                    <ProvenanceBadge
                      kind="fact"
                      source={fact.source}
                      official={fact.official}
                    />
                  </div>
                  <p className="text-muted mt-1 italic">&ldquo;{fact.quote}&rdquo;</p>
                </div>
              ))}
            </div>
          )}

          {aiKnowledge.suggestedAdditions.length > 0 && (
            <div className="space-y-2">
              <p className="text-foreground text-xs font-semibold">
                Worth adding (no source yet)
              </p>
              <ul className="space-y-1.5">
                {aiKnowledge.suggestedAdditions.map(addition => (
                  <li
                    key={addition}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="text-muted">{addition}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setTab('artifact')
                        setArtifactTitle(addition.split(':')[0]!.slice(0, 120))
                      }}
                      className="text-accent shrink-0 font-medium hover:underline"
                    >
                      Add as artifact
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Ingestion Panel */}
      <section
        className={`border-border bg-surface space-y-6 rounded-xl border p-6 ${
          editing ? '' : 'hidden'
        }`}
      >
        <div className="bg-surface-hover border-border flex w-fit items-center gap-1 rounded-lg border p-1">
          <button
            type="button"
            onClick={() => setTab('url')}
            className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors ${
              tab === 'url'
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <Globe className="text-accent h-3.5 w-3.5" />
            Add Web URL
          </button>
          <button
            type="button"
            onClick={() => setTab('artifact')}
            className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors ${
              tab === 'artifact'
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <FileText className="text-accent h-3.5 w-3.5" />
            Add Custom Artifact
          </button>
        </div>

        {tab === 'url' && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <input
                type="url"
                value={inputUrl}
                onChange={e => setInputUrl(e.target.value)}
                placeholder="https://company.com/blog/case-study or article URL"
                className="border-border bg-surface-hover text-foreground placeholder:text-muted focus:ring-accent flex-1 rounded-lg border px-3.5 py-2 text-sm focus:ring-1"
              />
              <button
                type="button"
                onClick={handleFetchUrl}
                disabled={isFetchingUrl || !inputUrl.trim()}
                className="bg-accent hover:bg-accent-hover text-background flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium shadow-sm transition-colors disabled:opacity-50"
              >
                {isFetchingUrl ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Fetching &amp; Extracting…
                  </>
                ) : (
                  'Fetch & Extract'
                )}
              </button>
            </div>

            {/* Extracted Preview */}
            {urlPreview && (
              <div className="border-border bg-surface-hover space-y-4 rounded-xl border p-5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Scraped successfully ({urlPreview.wordCount} words)
                  </span>
                  <span className="text-muted max-w-xs truncate text-xs">
                    {urlPreview.url}
                  </span>
                </div>

                <div>
                  <label className="text-foreground mb-1 block text-xs font-medium">
                    Document Title
                  </label>
                  <input
                    type="text"
                    value={urlPreview.title}
                    onChange={e =>
                      setUrlPreview({ ...urlPreview, title: e.target.value })
                    }
                    className="border-border bg-surface text-foreground w-full rounded-md border px-3 py-1.5 text-sm"
                  />
                </div>

                <div>
                  <label className="text-foreground mb-1 block text-xs font-medium">
                    Extracted Text Content
                  </label>
                  <textarea
                    rows={6}
                    value={urlPreview.content}
                    onChange={e =>
                      setUrlPreview({ ...urlPreview, content: e.target.value })
                    }
                    className="border-border bg-surface text-foreground w-full resize-none rounded-md border p-3 font-mono text-xs"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleSaveUrlDoc}
                    disabled={isSaving}
                    className="bg-accent hover:bg-accent-hover text-background flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors disabled:opacity-50"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Extracting Claims &amp; Saving…
                      </>
                    ) : (
                      'Save to Knowledge Base →'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'artifact' && (
          <div className="space-y-4">
            <div>
              <label className="text-foreground mb-1.5 block text-xs font-medium">
                Artifact Title
              </label>
              <input
                type="text"
                value={artifactTitle}
                onChange={e => setArtifactTitle(e.target.value)}
                placeholder="e.g. Q3 Customer Case Study: Fintech Cost Optimization"
                className="border-border bg-surface-hover text-foreground focus:ring-accent w-full rounded-lg border px-3.5 py-2 text-sm focus:ring-1"
              />
            </div>

            <div>
              <label className="text-foreground mb-1.5 block text-xs font-medium">
                Content (Case study, transcript, release note, interview, or
                talk)
              </label>
              <textarea
                rows={6}
                value={artifactContent}
                onChange={e => setArtifactContent(e.target.value)}
                placeholder="Paste the raw text here. Claude will summarize it and extract verifiable key claims with quotes..."
                className="border-border bg-surface-hover text-foreground focus:ring-accent w-full resize-none rounded-lg border p-3.5 text-sm focus:ring-1"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSaveArtifact}
                disabled={
                  isSaving || !artifactTitle.trim() || !artifactContent.trim()
                }
                className="bg-accent hover:bg-accent-hover text-background flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium shadow-sm transition-colors disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Analyzing Claims &amp; Saving…
                  </>
                ) : (
                  'Save Artifact →'
                )}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Ingested Documents List */}
      <section ref={docListRef} className="scroll-mt-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
            <BookOpen className="text-accent h-4 w-4" />
            Ingested Documents ({initialDocs.length})
          </h2>
          <span className="text-muted text-xs">
            Every statistic and anecdote traces back to an ingested claim
          </span>
        </div>

        {initialDocs.length === 0 ? (
          <div className="border-border bg-surface rounded-xl border border-dashed py-12 text-center">
            <p className="text-foreground text-sm font-medium">
              No documents in the knowledge base yet
            </p>
            <p className="text-muted mt-1 text-xs">
              Add a URL or paste an artifact above to ground your post
              generation in real proof.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pageDocs.map(doc => {
              // Summary and claims live in their own columns; rows written before
              // that still carry the packed JSON blob in `summary`.
              let summaryText = doc.summary || undefined
              let claims = doc.keyClaims || []
              if (summaryText?.trim().startsWith('{')) {
                try {
                  const packed = JSON.parse(summaryText)
                  summaryText = packed.summaryText || packed.summary || undefined
                  if (claims.length === 0 && Array.isArray(packed.claims)) {
                    claims = packed.claims
                  }
                } catch {
                  // Leave the raw value alone if it will not parse.
                }
              }
              const parsedSummary = { summaryText }
              const isExpanded = expandedDocId === doc.id

              return (
                <div
                  key={doc.id}
                  className="border-border bg-surface hover:border-accent/30 space-y-3 rounded-xl border p-5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${
                            doc.sourceType === 'url'
                              ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400'
                              : 'dark:bg-purple-950/40 bg-purple-50 text-purple-600 dark:text-purple-400'
                          }`}
                        >
                          {doc.sourceType}
                        </span>
                        <h3 className="text-foreground truncate text-sm font-semibold">
                          {doc.title}
                        </h3>
                        {doc.sourceUrl && (
                          <a
                            href={doc.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted hover:text-accent"
                            title="Visit Source"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>

                      {parsedSummary.summaryText && (
                        <p className="text-muted line-clamp-2 text-xs leading-relaxed">
                          {parsedSummary.summaryText}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedDocId(isExpanded ? null : doc.id)
                        }
                        className="text-accent flex items-center gap-1 text-xs font-medium hover:underline"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        {claims.length} Claims
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>

                      <ConfirmPopover
                        title="Delete this document?"
                        description="It is removed from the knowledge base, along with its extracted claims."
                        confirmLabel="Delete"
                        onConfirm={() => handleDelete(doc.id)}
                        disabled={deletingId === doc.id}
                      >
                        <button
                          type="button"
                          disabled={deletingId === doc.id}
                          className={`text-muted p-1 transition-colors hover:text-rose-500 ${
                            editing ? '' : 'hidden'
                          }`}
                          title="Delete document"
                        >
                          {deletingId === doc.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </ConfirmPopover>
                    </div>
                  </div>

                  {/* Expandable Verified Claims */}
                  {isExpanded && (
                    <div className="border-border space-y-3 border-t pt-3">
                      <p className="text-foreground text-xs font-semibold tracking-wider uppercase">
                        Extracted Key Claims &amp; Quotes ({claims.length})
                      </p>
                      {claims.length === 0 ? (
                        <p className="text-muted text-xs">
                          No claims extracted for this item.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {claims.map((c, cIdx) => (
                            <div
                              key={cIdx}
                              className="bg-surface-hover border-border space-y-1.5 rounded-lg border p-3"
                            >
                              <p className="text-foreground text-xs font-medium">
                                • {c.claim}
                              </p>
                              <div className="text-muted bg-surface flex items-start gap-1.5 rounded p-2 text-[11px] italic">
                                <Quote className="text-accent mt-0.5 h-3 w-3 shrink-0" />
                                <span>&quot;{c.quote}&quot;</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            <Pagination
              {...docPageInfo}
              noun="documents"
              onPageChange={setDocPage}
              scrollTarget={docListRef}
            />
          </div>
        )}
      </section>
    </div>
  )
}
