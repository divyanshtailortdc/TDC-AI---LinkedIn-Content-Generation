'use client'

import { Button } from '@/components/button'
import {
  sourceQuotes,
  type BlogSource,
  type BlogVerification,
  type CitationVerdict,
  type VerificationIssueKind
} from '@/lib/blogs/types'
import { cn } from '@/lib/cn'
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, ShieldCheck, XCircle } from 'lucide-react'

/**
 * What the blog was written from (web and idea sources S1…, knowledge
 * passages K1…) and how its citations held up: each sentence that links a
 * source, checked against it, and what still needs the author's eye.
 * References in the exports list the sources that support the text.
 */

const ISSUE_LABELS: Record<VerificationIssueKind, string> = {
  fact_without_source: 'A fact with no source',
  hypothetical_as_fact: 'A made-up scenario told as fact',
  sample_data_as_real: 'Demo data told as real',
  opinion_as_fact: 'A judgment told as fact',
  figure_not_in_source: 'A figure its source does not give',
  uncited_figure: 'A figure without its source linked',
  unlabelled_specific: 'A specific detail told as if it happened',
  generic_passage: 'Generic: says nothing specific to this reader',
  repeats_earlier_point: 'Repeats an earlier point',
  research_narration: 'Talks about the research, not the subject'
}

const VERDICTS: Record<
  CitationVerdict,
  { label: string; icon: typeof CheckCircle2; tone: string }
> = {
  supported: { label: 'Supports it', icon: CheckCircle2, tone: 'text-emerald-600 dark:text-emerald-400' },
  partial: { label: 'Supports part of it', icon: CircleDashed, tone: 'text-amber-600 dark:text-amber-400' },
  unsupported: { label: 'Does not support it', icon: XCircle, tone: 'text-red-600 dark:text-red-400' }
}

const checkedWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

export function SourcesPanel({
  sources,
  verification,
  checking,
  disabled,
  onCheck
}: {
  sources: BlogSource[]
  verification: BlogVerification | null
  checking: boolean
  disabled: boolean
  /** Checks the saved text's citations again. */
  onCheck: () => void
}) {
  if (sources.length === 0) {
    return (
      <p className="text-muted text-sm">
        No sources were gathered: it was written from your own details only,
        without figures from elsewhere.
      </p>
    )
  }
  const removed = verification?.removedLinks ?? []
  const issues = verification?.issues ?? []
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted text-xs leading-relaxed">
          {verification
            ? `Citations checked ${checkedWhen(verification.checkedAt)}.`
            : 'The citations have not been checked yet.'}
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={onCheck}
          loading={checking}
          disabled={disabled}
        >
          <ShieldCheck aria-hidden className="h-4 w-4" />
          Check sources again
        </Button>
      </div>

      {(issues.length > 0 || removed.length > 0) && (
        <section
          aria-label="Needs checking"
          className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3"
        >
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200">
            <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
            Check before publishing
          </h3>
          <ul className="space-y-2">
            {removed.map(item => (
              <li key={`removed-${item.sourceId}-${item.sentence}`} className="text-xs leading-relaxed">
                <span className="text-foreground font-medium">
                  Link to {item.sourceId} taken off:
                </span>{' '}
                <span className="text-muted">“{item.sentence}”</span>
              </li>
            ))}
            {issues.map(issue => (
              <li key={`${issue.issue}-${issue.sentence}`} className="text-xs leading-relaxed">
                <span className="text-foreground font-medium">
                  {ISSUE_LABELS[issue.issue]}:
                </span>{' '}
                <span className="text-muted">“{issue.sentence}”</span>
                {issue.note && <span className="text-muted block">{issue.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="space-y-2.5">
        {sources.map(source => {
          const citations = (verification?.citations ?? []).filter(
            citation => citation.sourceId === source.id
          )
          return (
            <li key={source.id} className="border-border rounded-xl border p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="bg-surface-hover text-foreground rounded px-1.5 py-0.5 font-mono text-[11px]">
                  {source.id}
                </span>
                {source.cited && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    Cited
                  </span>
                )}
                {source.verifiedOn === 'page' && (
                  <span className="bg-surface-hover text-foreground rounded-full px-2 py-0.5 text-[11px] font-semibold">
                    Read on the page
                  </span>
                )}
                {source.verifiedOn === 'snippet' && (
                  <span className="bg-surface-hover text-muted rounded-full px-2 py-0.5 text-[11px] font-semibold">
                    Search snippet only
                  </span>
                )}
                {source.origin === 'knowledge' && source.ownPage === true && (
                  <span className="bg-surface-hover text-muted rounded-full px-2 py-0.5 text-[11px] font-semibold">
                    Your site
                  </span>
                )}
                {source.origin === 'knowledge' && source.ownPage === false && (
                  <span className="bg-surface-hover text-muted rounded-full px-2 py-0.5 text-[11px] font-semibold">
                    About you, elsewhere
                  </span>
                )}
                {source.origin === 'knowledge' && !source.url && (
                  <span className="bg-surface-hover text-muted rounded-full px-2 py-0.5 text-[11px] font-semibold">
                    Internal
                  </span>
                )}
                {source.rating && (
                  <span className="text-muted text-[11px]">{source.rating.label}</span>
                )}
              </div>
              <p className="text-foreground mt-1.5 text-sm leading-snug font-medium">
                {source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-brand-strong inline-flex items-start gap-1 underline-offset-2 hover:underline"
                  >
                    {source.title}
                    <ExternalLink aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  source.title
                )}
              </p>
              {(source.publisher || source.publishedAt) && (
                <p className="text-muted text-xs">
                  {[source.publisher, source.publishedAt].filter(Boolean).join(' · ')}
                </p>
              )}
              <ul className="mt-1.5 space-y-1">
                {sourceQuotes(source).slice(0, 4).map(quote => (
                  <li key={quote} className="text-muted line-clamp-3 text-xs leading-relaxed">
                    “{quote}”
                  </li>
                ))}
              </ul>
              {citations.length > 0 && (
                <ul className="border-border mt-2 space-y-1.5 border-t pt-2">
                  {citations.map(citation => {
                    const verdict = VERDICTS[citation.verdict]
                    const Icon = verdict.icon
                    return (
                      <li key={citation.sentence} className="text-xs leading-relaxed">
                        <span className={cn('inline-flex items-center gap-1 font-semibold', verdict.tone)}>
                          <Icon aria-hidden className="h-3.5 w-3.5" />
                          {verdict.label}
                        </span>{' '}
                        <span className="text-foreground">“{citation.sentence}”</span>
                        {citation.reason && (
                          <span className="text-muted block">{citation.reason}</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
