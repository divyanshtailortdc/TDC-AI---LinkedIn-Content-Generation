'use client'

import { DOC_PAGES, docHref } from '@/docs/nav'
import {
  categoryOf,
  isQuestion,
  queryTerms,
  searchDocsIndex,
  snippetHash,
  type DocSearchResult,
  type DocsSearchIndexPage
} from '@/docs/search'
import { cn } from '@/lib/cn'
import {
  CornerDownLeft,
  FileText,
  Loader2,
  Search,
  Sparkles,
  TextQuote,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'

/** Fired after opening a search result, so the page scrolls to its text. */
export const DOCS_FIND_EVENT = 'docs:find'
export type DocsFindDetail = { slug: string; text: string; section?: string }

const noSubscribe = () => () => {}

/** ⌘ on Apple keyboards, Ctrl elsewhere; Ctrl on the server. */
export function useModifierKeyLabel() {
  return useSyncExternalStore(
    noSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'),
    () => 'Ctrl'
  )
}

let indexRequest: Promise<DocsSearchIndexPage[]> | null = null

/** The pages' text, fetched once per visit and then kept. */
function loadIndex() {
  indexRequest ??= fetch('/api/docs/search-index')
    .then(response => {
      if (!response.ok) throw new Error(`Search index: ${response.status}`)
      return response.json() as Promise<{ pages: DocsSearchIndexPage[] }>
    })
    .then(data => data.pages)
    .catch(error => {
      indexRequest = null
      throw error
    })
  return indexRequest
}

/** Meaning-based search answers 401 when signed out; then it is not asked again. */
let aiUnavailable = false

type AiAnswer = {
  query: string
  results: DocSearchResult[]
  error?: string
}

type Row =
  | { kind: 'page'; result: DocSearchResult; href: string }
  | {
      kind: 'snippet'
      result: DocSearchResult
      href: string
      text: string
      heading: string
      sectionId: string
    }

function rowsFor(results: DocSearchResult[], withSnippets: boolean): Row[] {
  return results.flatMap(result => {
    const href = docHref(result.slug)
    return [
      { kind: 'page' as const, result, href },
      ...(withSnippets
        ? result.snippets
            .filter(snippet => snippet.text)
            .map(snippet => ({
              kind: 'snippet' as const,
              result,
              href: `${href}${snippetHash(snippet)}`,
              text: snippet.text,
              heading: snippet.heading,
              sectionId: snippet.sectionId
            }))
        : [])
    ]
  })
}

/** The words of the query in a snippet, marked. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>
  const pattern = new RegExp(
    `\\b(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\w*`,
    'gi'
  )
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) parts.push(text.slice(last, index))
    parts.push(
      <mark
        key={index}
        className="text-foreground rounded-sm bg-amber-200/70 px-0.5 dark:bg-amber-400/25"
      >
        {match[0]}
      </mark>
    )
    last = index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

const SUGGESTED = DOC_PAGES.slice(0, 6).map(page => ({
  slug: page.slug,
  title: page.title,
  category: categoryOf(page),
  snippets: page.description
    ? [{ sectionId: '', heading: page.title, text: page.description }]
    : []
}))

/**
 * Search across the help pages: by words as you type, and by meaning for a
 * question (or when no page has the words), as in potential-adventure's
 * docs. Arrow keys move through pages and their matching passages; Enter
 * opens one.
 */
export function DocsSearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<DocsSearchIndexPage[] | null>(null)
  const [indexError, setIndexError] = useState(false)
  const [ai, setAi] = useState<AiAnswer | null>(null)
  const [aiOff, setAiOff] = useState(aiUnavailable)
  const [selected, setSelected] = useState(0)
  const modifier = useModifierKeyLabel()

  useEffect(() => {
    let cancelled = false
    loadIndex().then(
      pages => !cancelled && setIndex(pages),
      () => !cancelled && setIndexError(true)
    )
    return () => {
      cancelled = true
    }
  }, [])

  // The page behind does not scroll while the dialog is open.
  useEffect(() => {
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [])

  const trimmed = query.trim()
  const terms = useMemo(() => queryTerms(trimmed), [trimmed])
  const local = useMemo(
    () => (index && trimmed ? searchDocsIndex(index, trimmed) : []),
    [index, trimmed]
  )
  const question = isQuestion(trimmed)
  const wantsAi =
    !aiOff &&
    trimmed.length >= 3 &&
    (question || (index !== null && local.length === 0))

  useEffect(() => {
    if (!wantsAi) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch('/api/docs/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
        signal: controller.signal
      })
        .then(async response => {
          if (response.status === 401 || response.status === 503) {
            // Signed out, or AI not set up: search by words only.
            aiUnavailable = true
            setAiOff(true)
            return
          }
          const data = (await response.json().catch(() => ({}))) as {
            results?: DocSearchResult[]
            error?: string
          }
          setAi({
            query: trimmed,
            results: response.ok ? (data.results ?? []) : [],
            error: response.ok ? undefined : data.error
          })
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setAi({
              query: trimmed,
              results: [],
              error: 'Could not search by meaning just now.'
            })
        })
    }, 450)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [wantsAi, trimmed])

  const aiCurrent = ai?.query === trimmed ? ai : null
  const aiLoading = wantsAi && !aiCurrent
  const aiResults = wantsAi ? (aiCurrent?.results ?? []) : []
  const localShown = local.filter(
    result => !aiResults.some(answer => answer.slug === result.slug)
  )

  const groups: Array<{ label: string; ai?: boolean; rows: Row[] }> = trimmed
    ? [
        ...(aiResults.length > 0
          ? [
              {
                label: 'Best answers',
                ai: true,
                rows: rowsFor(aiResults, true)
              }
            ]
          : []),
        ...(localShown.length > 0
          ? [
              {
                label: aiResults.length > 0 ? 'More pages' : 'Pages',
                rows: rowsFor(localShown, true)
              }
            ]
          : [])
      ]
    : [{ label: 'Start here', rows: rowsFor(SUGGESTED, false) }]
  const rows = groups.flatMap(group => group.rows)
  /** Where each group's rows start in `rows`, for the selection. */
  const groupStarts = groups.map((_, g) =>
    groups.slice(0, g).reduce((sum, group) => sum + group.rows.length, 0)
  )

  // A new set of results starts at the top.
  const resultsKey = rows.map(row => row.href).join('\n')
  const [shownKey, setShownKey] = useState(resultsKey)
  if (resultsKey !== shownKey) {
    setShownKey(resultsKey)
    setSelected(0)
  }

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-row="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const open = (row: Row) => {
    onClose()
    router.push(row.href)
    if (row.kind === 'snippet') {
      // A result on the page already open: no new page reads the address,
      // so the page is told directly.
      window.dispatchEvent(
        new CustomEvent<DocsFindDetail>(DOCS_FIND_EVENT, {
          detail: {
            slug: row.result.slug,
            text: row.text.replace(/^…|…$/g, ''),
            section: row.sectionId || undefined
          }
        })
      )
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(i => Math.min(i + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const row = rows[selected]
      if (row) {
        e.preventDefault()
        open(row)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const empty = trimmed && rows.length === 0 && !aiLoading

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search documentation"
      onKeyDown={onKeyDown}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh] backdrop-blur-xs motion-safe:animate-[overlay-in_150ms_ease-out]"
    >
      <div className="border-border bg-surface flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl motion-safe:animate-[dialog-in_200ms_cubic-bezier(0.16,1,0.3,1)]">
        <div className="border-border flex items-center gap-3 border-b px-4">
          <Search aria-hidden className="text-muted h-5 w-5 shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search the docs, or ask a question…"
            aria-label="Search the docs"
            aria-controls={listId}
            aria-activedescendant={
              rows.length > 0 ? `${listId}-row-${selected}` : undefined
            }
            role="combobox"
            aria-expanded="true"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            className="text-foreground placeholder:text-muted h-14 min-w-0 flex-1 bg-transparent text-base outline-none"
          />
          {aiLoading && (
            <Loader2
              aria-label="Searching by meaning"
              className="text-muted h-4 w-4 shrink-0 animate-spin"
            />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="text-muted hover:bg-surface-hover hover:text-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Results"
          className="min-h-48 flex-1 overflow-y-auto p-2"
        >
          {indexError && !trimmed && (
            <p className="text-muted px-3 py-8 text-center text-sm">
              Search could not load. Check your connection and try again.
            </p>
          )}
          {!indexError &&
            groups.map((group, g) => (
              <div key={group.label} className="mb-2">
                <p className="text-muted flex items-center gap-1.5 px-3 pt-2 pb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase">
                  {group.ai && (
                    <Sparkles aria-hidden className="text-brand h-3.5 w-3.5" />
                  )}
                  {group.label}
                </p>
                {group.rows.map((row, r) => {
                  const i = (groupStarts[g] ?? 0) + r
                  const isSelected = i === selected
                  return (
                    <div
                      key={row.href}
                      id={`${listId}-row-${i}`}
                      data-row={i}
                      role="option"
                      aria-selected={isSelected}
                      onMouseMove={() => !isSelected && setSelected(i)}
                      onClick={() => open(row)}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-xl px-3 transition-colors',
                        row.kind === 'page' ? 'py-2.5' : 'ml-6 py-2',
                        isSelected ? 'bg-brand/12' : 'hover:bg-surface-hover'
                      )}
                    >
                      {row.kind === 'page' ? (
                        <FileText
                          aria-hidden
                          className="text-muted mt-0.5 h-4.5 w-4.5 shrink-0"
                        />
                      ) : (
                        <TextQuote
                          aria-hidden
                          className="text-muted mt-0.5 h-4 w-4 shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        {row.kind === 'page' ? (
                          <>
                            <p
                              className={cn(
                                'truncate text-sm font-medium',
                                isSelected
                                  ? 'text-brand-strong'
                                  : 'text-foreground'
                              )}
                            >
                              {row.result.title}
                            </p>
                            <p className="text-muted truncate text-xs">
                              {row.result.category}
                            </p>
                            {!trimmed && row.result.snippets[0] && (
                              <p className="text-muted mt-0.5 line-clamp-1 text-xs">
                                {row.result.snippets[0].text}
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            {row.heading &&
                              row.heading !== row.result.title && (
                                <p className="text-foreground/80 truncate text-xs font-medium">
                                  {row.heading}
                                </p>
                              )}
                            <p className="text-muted line-clamp-2 text-[13px] leading-snug">
                              <Highlighted text={row.text} terms={terms} />
                            </p>
                          </>
                        )}
                      </div>
                      {isSelected && (
                        <CornerDownLeft
                          aria-hidden
                          className="text-muted mt-1 h-3.5 w-3.5 shrink-0"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          {trimmed && !index && !indexError && (
            <p className="text-muted flex items-center justify-center gap-2 px-3 py-8 text-sm">
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              Loading…
            </p>
          )}
          {empty && index && (
            <div className="px-3 py-10 text-center">
              <p className="text-foreground text-sm font-medium">
                No results for “{trimmed}”
              </p>
              <p className="text-muted mt-1 text-sm">
                {aiCurrent?.error ??
                  'Try other words, or browse the sections on the left.'}
              </p>
            </div>
          )}
          {trimmed && aiLoading && rows.length === 0 && index && (
            <p className="text-muted flex items-center justify-center gap-2 px-3 py-8 text-sm">
              <Sparkles aria-hidden className="text-brand h-4 w-4" />
              Searching by meaning…
            </p>
          )}
        </div>

        <div className="border-border text-muted hidden items-center gap-4 border-t px-4 py-2.5 text-xs sm:flex">
          <span>
            <kbd className="font-mono">↑</kbd>{' '}
            <kbd className="font-mono">↓</kbd> to move
          </span>
          <span>
            <kbd className="font-mono">Enter</kbd> to open
          </span>
          <span>
            <kbd className="font-mono">Esc</kbd> to close
          </span>
          <span className="ml-auto">
            {aiOff
              ? 'Sign in to also search by meaning'
              : 'Questions are also searched by meaning'}
            {' · '}
            <kbd className="font-mono">{modifier} K</kbd>
          </span>
        </div>
      </div>
    </div>
  )
}
