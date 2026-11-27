'use client'

import { FIELD_CLASS, Select, TextArea, TextField } from '@/components/ui/field'
import type { BlogEdit } from '@/lib/blogs/input'
import { CHECK_GROUP_LABELS, CHECK_GROUPS, checkGroup } from '@/lib/blogs/quality'
import { seoSummary } from '@/lib/blogs/seo'
import {
  isSearchIntent,
  SEARCH_INTENT_LABELS,
  SEARCH_INTENTS
} from '@/lib/blogs/types'
import { cn } from '@/lib/cn'
import type { LintFinding } from '@/lib/lint/run-linter'
import { AlertTriangle, CircleCheck, CircleX, Info } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { KeywordInput } from '../keyword-input'

/**
 * The SEO side of the blog: its meta title and description, slug and
 * keywords, how it shows in search results, the SEO checklist (live, as the
 * text changes) and the other checks from its last save, in four groups:
 * accuracy, sources, writing, and search & AI answers.
 */
export function SeoPanel({
  edit,
  onChange,
  disabled,
  liveChecks,
  savedChecks,
  notes,
  site
}: {
  edit: BlogEdit
  onChange: (patch: Partial<BlogEdit>) => void
  disabled: boolean
  /** The identity's site for the search preview, e.g. "tdccommerce.com". */
  site: string | null
  /** The SEO checklist of the text as it is now. */
  liveChecks: LintFinding[]
  /** Every check as of the last save or generation. */
  savedChecks: LintFinding[]
  /** What the writing step noted (links it removed, research that failed). */
  notes: string[]
}) {
  const { passed, total } = seoSummary(liveChecks)
  // The live checklist already shows its own rules as the text changes.
  const live = new Set(liveChecks.map(f => f.rule))
  const open = savedChecks.filter(f => !f.passed && !live.has(f.rule))
  const groups = CHECK_GROUPS.map(group => ({
    group,
    findings: open.filter(f => checkGroup(f.rule) === group)
  })).filter(entry => entry.findings.length > 0)
  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <CountedField
          label="Meta title"
          value={edit.metaTitle}
          range={[30, 60]}
          disabled={disabled}
          onChange={metaTitle => onChange({ metaTitle })}
        />
        <CountedField
          label="Meta description"
          value={edit.metaDescription}
          range={[120, 160]}
          multiline
          disabled={disabled}
          onChange={metaDescription => onChange({ metaDescription })}
        />
        <Labeled label="URL slug">
          {id => (
            <div
              className={cn(
                FIELD_CLASS,
                'focus-within:border-brand focus-within:ring-brand/15 flex items-start gap-0.5 py-0 pr-0 focus-within:ring-3',
                disabled && 'opacity-60'
              )}
            >
              <span aria-hidden className="text-muted py-2">
                /
              </span>
              <TextField
                id={id}
                value={edit.slug}
                disabled={disabled}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={event => onChange({ slug: event.target.value })}
                className="rounded-none border-0 bg-transparent pl-0 shadow-none focus:ring-0 disabled:opacity-100"
              />
            </div>
          )}
        </Labeled>
        <Labeled label="Primary keyword">
          {id => (
            <TextField
              id={id}
              value={edit.primaryKeyword}
              disabled={disabled}
              onChange={event =>
                onChange({ primaryKeyword: event.target.value })
              }
            />
          )}
        </Labeled>
        <Labeled label="Secondary keywords">
          {id => (
            <KeywordInput
              id={id}
              value={edit.keywords}
              disabled={disabled}
              onChange={keywords => onChange({ keywords })}
            />
          )}
        </Labeled>
        <Labeled label="Search intent">
          {id => (
            <Select
              id={id}
              value={edit.searchIntent}
              disabled={disabled}
              onChange={event => {
                const value = event.target.value
                onChange({ searchIntent: isSearchIntent(value) ? value : '' })
              }}
            >
              <option value="">Not set</option>
              {SEARCH_INTENTS.map(intent => (
                <option key={intent} value={intent}>
                  {SEARCH_INTENT_LABELS[intent]}
                </option>
              ))}
            </Select>
          )}
        </Labeled>
      </section>

      <section>
        <h3 className="text-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
          In search results
        </h3>
        <SearchResult edit={edit} site={site} />
      </section>

      <section>
        <h3 className="text-foreground mb-2 flex items-center justify-between text-xs font-semibold tracking-wide uppercase">
          SEO checklist
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] normal-case',
              passed === total
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
            )}
          >
            {passed}/{total} passed
          </span>
        </h3>
        <FindingList findings={liveChecks} />
      </section>

      <section>
        <h3 className="text-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
          Quality checks
        </h3>
        <p className="text-muted mb-2 text-xs">As of the last save.</p>
        {groups.length === 0 ? (
          <p className="text-muted flex items-center gap-1.5 text-sm">
            <CircleCheck aria-hidden className="h-4 w-4 text-emerald-600" />
            Nothing to fix.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map(({ group, findings }) => (
              <div key={group}>
                <h4 className="text-foreground mb-1.5 flex items-center justify-between text-sm font-medium">
                  {CHECK_GROUP_LABELS[group]}
                  <span className="text-muted text-xs font-normal">
                    {findings.length} to look at
                  </span>
                </h4>
                <FindingList findings={findings} />
              </div>
            ))}
          </div>
        )}
      </section>

      {notes.length > 0 && (
        <section>
          <h3 className="text-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
            Notes from writing
          </h3>
          <ul className="space-y-1.5">
            {notes.map(note => (
              <li key={note} className="text-muted flex gap-1.5 text-sm">
                <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                {note}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Labeled({
  label,
  extra,
  children
}: {
  label: string
  extra?: ReactNode
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-foreground text-sm font-medium">
          {label}
        </label>
        {extra}
      </div>
      {children(id)}
    </div>
  )
}

function CountedField({
  label,
  value,
  range: [min, max],
  multiline = false,
  disabled,
  onChange
}: {
  label: string
  value: string
  range: [number, number]
  multiline?: boolean
  disabled: boolean
  onChange: (value: string) => void
}) {
  const count = Array.from(value.trim()).length
  const fits = count >= min && count <= max
  return (
    <Labeled
      label={label}
      extra={
        <span
          className={cn(
            'text-xs tabular-nums',
            fits
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-amber-700 dark:text-amber-400'
          )}
        >
          {count}/{max}
        </span>
      }
    >
      {id =>
        multiline ? (
          <TextArea
            id={id}
            rows={3}
            maxRows={8}
            value={value}
            disabled={disabled}
            onChange={event => onChange(event.target.value)}
          />
        ) : (
          <TextField
            id={id}
            value={value}
            disabled={disabled}
            onChange={event => onChange(event.target.value)}
          />
        )
      }
    </Labeled>
  )
}

/** Roughly how a search engine shows the page. */
export function SearchResult({
  edit,
  site
}: {
  edit: Pick<BlogEdit, 'metaTitle' | 'title' | 'metaDescription' | 'slug'>
  /** The identity's site; a placeholder without one. */
  site: string | null
}) {
  const title = edit.metaTitle.trim() || edit.title.trim() || 'Your meta title'
  return (
    <div className="border-border bg-background rounded-xl border p-3">
      <p className="text-muted truncate text-xs">
        {site || 'yourwebsite.com'} › {edit.slug || 'your-slug'}
      </p>
      <p className="mt-0.5 line-clamp-1 text-[17px] leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">
        {title}
      </p>
      <p className="text-muted mt-0.5 line-clamp-2 text-[13px] leading-snug">
        {edit.metaDescription.trim() || 'Your meta description shows here.'}
      </p>
    </div>
  )
}

function FindingList({ findings }: { findings: LintFinding[] }) {
  const ordered = [...findings].sort((a, b) => rank(a) - rank(b))
  return (
    <ul className="space-y-1.5">
      {ordered.map(finding => (
        <li
          key={`${finding.rule}:${finding.message}`}
          className="flex gap-1.5 text-sm leading-snug"
        >
          {finding.passed ? (
            <CircleCheck
              aria-label="Passed"
              className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
            />
          ) : finding.severity === 'error' ? (
            <CircleX
              aria-label="Must fix"
              className="mt-0.5 h-4 w-4 shrink-0 text-rose-600"
            />
          ) : (
            <AlertTriangle
              aria-label="Worth fixing"
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
            />
          )}
          <span className={finding.passed ? 'text-muted' : 'text-foreground'}>
            {finding.message}
          </span>
        </li>
      ))}
    </ul>
  )
}

const rank = (finding: LintFinding) =>
  finding.passed ? 2 : finding.severity === 'error' ? 0 : 1
