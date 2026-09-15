'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Globe,
  FileText,
  Loader2,
  Trash2,
  ExternalLink,
  BookOpen,
  CheckCircle2,
  Quote,
  Layers,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { fetchUrlPreview, saveKnowledgeDocument, deleteKnowledgeDocument } from './actions'

type KnowledgeDoc = {
  id: string
  title: string
  sourceType: string
  sourceUrl: string | null
  content: string
  summary: string | null
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

  // URL state
  const [inputUrl, setInputUrl] = useState('')
  const [isFetchingUrl, setIsFetchingUrl] = useState(false)
  const [urlPreview, setUrlPreview] = useState<{
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

  const handleFetchUrl = async () => {
    if (!inputUrl.trim()) return
    setError(null)
    setIsFetchingUrl(true)
    setUrlPreview(null)

    const res = await fetchUrlPreview(inputUrl)
    if (res.success && res.title && res.content) {
      setUrlPreview({
        title: res.title,
        content: res.content,
        wordCount: res.wordCount || res.content.split(/\s+/).length
      })
    } else {
      setError(res.error || 'Failed to fetch webpage content')
    }
    setIsFetchingUrl(false)
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
        sourceUrl: inputUrl,
        content: urlPreview.content
      })
      setInputUrl('')
      setUrlPreview(null)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to save document')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveArtifact = async () => {
    if (!artifactTitle.trim() || !artifactContent.trim()) {
      setError('Please provide both a title and artifact content.')
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
      setArtifactTitle('')
      setArtifactContent('')
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to save artifact')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (docId: string) => {
    if (!confirm('Are you sure you want to delete this document from the knowledge base?')) {
      return
    }
    setDeletingId(docId)
    try {
      await deleteKnowledgeDocument(docId, accountId)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to delete document')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Knowledge Base</h1>
        <p className="text-sm text-muted mt-1">
          Add URLs and artifacts to build a grounded fact base. AI extracts verified key claims and quotes so generated posts are factually anchored.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* Ingestion Panel */}
      <section className="rounded-xl border border-border bg-surface p-6 space-y-6">
        <div className="flex items-center gap-2 p-1 rounded-lg bg-surface-hover border border-border w-fit">
          <button
            type="button"
            onClick={() => setTab('url')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              tab === 'url'
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-accent" />
            Add Web URL
          </button>
          <button
            type="button"
            onClick={() => setTab('artifact')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              tab === 'artifact'
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-accent" />
            Add Custom Artifact
          </button>
        </div>

        {tab === 'url' && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <input
                type="url"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="https://company.com/blog/case-study or article URL"
                className="flex-1 rounded-lg border border-border bg-surface-hover px-3.5 py-2 text-sm text-foreground placeholder:text-muted focus:ring-1 focus:ring-accent"
              />
              <button
                type="button"
                onClick={handleFetchUrl}
                disabled={isFetchingUrl || !inputUrl.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-background text-sm font-medium transition-colors disabled:opacity-50 shrink-0 shadow-sm"
              >
                {isFetchingUrl ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Fetching &amp; Extracting…
                  </>
                ) : (
                  'Fetch & Extract'
                )}
              </button>
            </div>

            {/* Extracted Preview */}
            {urlPreview && (
              <div className="rounded-xl border border-border bg-surface-hover p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Scraped successfully ({urlPreview.wordCount} words)
                  </span>
                  <span className="text-xs text-muted truncate max-w-xs">{inputUrl}</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Document Title</label>
                  <input
                    type="text"
                    value={urlPreview.title}
                    onChange={(e) => setUrlPreview({ ...urlPreview, title: e.target.value })}
                    className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Extracted Text Content</label>
                  <textarea
                    rows={6}
                    value={urlPreview.content}
                    onChange={(e) => setUrlPreview({ ...urlPreview, content: e.target.value })}
                    className="w-full rounded-md border border-border bg-surface p-3 text-xs font-mono text-foreground resize-none"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleSaveUrlDoc}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-background text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
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
              <label className="block text-xs font-medium text-foreground mb-1.5">Artifact Title</label>
              <input
                type="text"
                value={artifactTitle}
                onChange={(e) => setArtifactTitle(e.target.value)}
                placeholder="e.g. Q3 Customer Case Study: Fintech Cost Optimization"
                className="w-full rounded-lg border border-border bg-surface-hover px-3.5 py-2 text-sm text-foreground focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Content (Case study, transcript, release note, interview, or talk)
              </label>
              <textarea
                rows={6}
                value={artifactContent}
                onChange={(e) => setArtifactContent(e.target.value)}
                placeholder="Paste the raw text here. Claude will summarize it and extract verifiable key claims with quotes..."
                className="w-full rounded-lg border border-border bg-surface-hover p-3.5 text-sm text-foreground focus:ring-1 focus:ring-accent resize-none"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSaveArtifact}
                disabled={isSaving || !artifactTitle.trim() || !artifactContent.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-background text-sm font-medium transition-colors disabled:opacity-50 shadow-sm"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
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
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-accent" />
            Ingested Documents ({initialDocs.length})
          </h2>
          <span className="text-xs text-muted">
            Every statistic and anecdote traces back to an ingested claim
          </span>
        </div>

        {initialDocs.length === 0 ? (
          <div className="py-12 text-center rounded-xl border border-dashed border-border bg-surface">
            <p className="text-sm font-medium text-foreground">No documents in the knowledge base yet</p>
            <p className="text-xs text-muted mt-1">
              Add a URL or paste an artifact above to ground your post generation in real proof.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {initialDocs.map((doc) => {
              let parsedSummary: { summaryText?: string; claims?: Array<{ claim: string; quote: string }> } = {}
              try {
                if (doc.summary) {
                  parsedSummary = JSON.parse(doc.summary)
                }
              } catch {
                parsedSummary = { summaryText: doc.summary || undefined }
              }

              const claims = parsedSummary.claims || []
              const isExpanded = expandedDocId === doc.id

              return (
                <div
                  key={doc.id}
                  className="rounded-xl border border-border bg-surface p-5 space-y-3 transition-colors hover:border-accent/30"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                          doc.sourceType === 'url'
                            ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                            : 'bg-purple-50 dark:purple-950/40 text-purple-600 dark:text-purple-400'
                        }`}>
                          {doc.sourceType}
                        </span>
                        <h3 className="text-sm font-semibold text-foreground truncate">{doc.title}</h3>
                        {doc.sourceUrl && (
                          <a
                            href={doc.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted hover:text-accent"
                            title="Visit Source"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>

                      {parsedSummary.summaryText && (
                        <p className="text-xs text-muted line-clamp-2 leading-relaxed">
                          {parsedSummary.summaryText}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                        className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        {claims.length} Claims
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id)}
                        disabled={deletingId === doc.id}
                        className="text-muted hover:text-rose-500 transition-colors p-1"
                        title="Delete document"
                      >
                        {deletingId === doc.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expandable Verified Claims */}
                  {isExpanded && (
                    <div className="pt-3 border-t border-border space-y-3">
                      <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
                        Extracted Key Claims &amp; Quotes ({claims.length})
                      </p>
                      {claims.length === 0 ? (
                        <p className="text-xs text-muted">No claims extracted for this item.</p>
                      ) : (
                        <div className="space-y-2">
                          {claims.map((c, cIdx) => (
                            <div key={cIdx} className="p-3 rounded-lg bg-surface-hover border border-border space-y-1.5">
                              <p className="text-xs font-medium text-foreground">
                                • {c.claim}
                              </p>
                              <div className="flex items-start gap-1.5 text-[11px] text-muted italic bg-surface p-2 rounded">
                                <Quote className="w-3 h-3 text-accent shrink-0 mt-0.5" />
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
          </div>
        )}
      </section>
    </div>
  )
}
