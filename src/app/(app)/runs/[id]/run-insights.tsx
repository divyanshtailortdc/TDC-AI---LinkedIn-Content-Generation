'use client'

import { useId, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, ExternalLink, Gauge, Search, SearchX } from 'lucide-react'
import { Button } from '@/components/button'
import { Pagination } from '@/components/pagination'
import { EmptyState } from '@/components/ui/empty-state'
import { FIELD_CLASS } from '@/components/ui/field'
import { FilterChips } from '@/components/ui/filter-chips'
import { StackedBar, type BarSegment } from '@/components/ui/meter'
import { SectionCard } from '@/components/ui/section-card'
import { ToneDot } from '@/components/ui/status-chip'
import { FOCUS_RING, TONES, type Tone } from '@/components/ui/tone'
import { cn } from '@/lib/cn'
import { DIMENSION_LABELS, JUDGED_DIMENSIONS } from '@/lib/idea-scorecard'
import { PAGE_SIZE, paginate } from '@/lib/pagination'
import {
  KIND_LABELS,
  kindOfProvider,
  ownHosts,
  rateSource,
  TIER_LABELS,
  TIER_SCORES
} from '~/lib/research/source-credibility'
import { plural } from '../run-display'

/**
 * The run page's read-outs of what each stage saved on its step (see
 * ideation-run): the figures under each stage, the evidence, the idea
 * quality and the problems. Every figure may be missing on a run from before
 * it was saved, so each is read through num() or list() and its block left
 * out when absent.
 */

/** A number saved on a step, or null when an older run did not save it. */
export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function list<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/** The site name to show for a source link, or null when it isn't a web URL. */
export function sourceHost(url?: string | null): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

// Every stage a step can record, for labelling errors.
const STEP_LABELS: Record<string, string> = {
  gathering_context: 'Gathering context',
  researching: 'Research',
  generating_ideas: 'Ideation',
  drafting: 'Drafting',
  linting: 'Revision pass',
  media: 'Media'
}

/** How far a source can be trusted, as a tone: trusted green down to weak red. */
function trustTone(score: number): Tone {
  if (score >= 80) return 'success'
  if (score >= 60) return 'info'
  if (score >= 50) return 'neutral'
  if (score >= 35) return 'warning'
  return 'danger'
}

/** A credibility label's score, from the tier it names ("News site" is an unrated news-search hit). */
const LABEL_SCORES: Record<string, number> = {
  ...Object.fromEntries(
    Object.entries(TIER_LABELS).map(([tier, label]) => [
      label,
      TIER_SCORES[tier as keyof typeof TIER_SCORES]
    ])
  ),
  'News site': 60
}

/** The research step's evidence figures. */
function evidenceOf(research: Record<string, any> | null) {
  const n = (key: string) => num(research?.[key])
  const webFindings = n('webFindings')
  const trendSignals = n('trendSignals')
  const passages = n('knowledgePassages')
  const claims = n('knowledgeClaims')
  const summaries = n('documentSummaries')
  return {
    webFindings,
    trendSignals,
    // webFindings counts every kept search result, the trend scan's among them.
    webOnly: webFindings === null ? null : Math.max(0, webFindings - (trendSignals ?? 0)),
    newsletterStories: n('newsletterStories'),
    newsletterItems: n('newsletterItems'),
    knowledge:
      passages === null && claims === null && summaries === null
        ? null
        : (passages ?? 0) + (claims ?? 0) + (summaries ?? 0),
    offeringFacts: n('offeringFacts'),
    totalEvidence: n('totalEvidence'),
    recentEvidence: n('recentEvidence'),
    screenedOutCount: n('screenedOutCount')
  }
}

const joinParts = (parts: unknown[]) => parts.filter(Boolean).join(' · ') || null

/**
 * The figure under a stage on the stepper, and the fuller breakdown for its
 * hover text. This is the run's summary: one figure per stage.
 */
export function stageFigure(
  key: string,
  data: {
    context: Record<string, any> | null
    research: Record<string, any> | null
    ideation: Record<string, any> | null
    drafting: number
  }
): { text: string | null; hover: string | null } {
  if (key === 'gathering_context' && data.context) {
    const goals = list(data.context.goals).length
    const docs = num(data.context.knowledgeDocs)
    const offerings = num(data.context.offerings)
    const audiences = num(data.context.audiences)
    const region = typeof data.context.region === 'string' ? data.context.region : null
    return {
      text: joinParts([goals > 0 && plural(goals, 'goal'), docs !== null && plural(docs, 'doc')]),
      hover: joinParts([
        offerings !== null && plural(offerings, 'offering'),
        audiences !== null && plural(audiences, 'audience'),
        docs !== null && plural(docs, 'knowledge base document'),
        region && `readers in ${region}`
      ])
    }
  }
  if (key === 'researching' && data.research) {
    const ev = evidenceOf(data.research)
    if (data.research.mode === 'off' && !ev.webOnly) {
      return { text: 'Web search off', hover: null }
    }
    return {
      text: joinParts([
        ev.webFindings !== null && plural(ev.webFindings, 'source'),
        (ev.newsletterStories ?? 0) > 0 && plural(ev.newsletterStories!, 'story', 'stories')
      ]),
      hover: joinParts([
        ev.webOnly !== null && plural(ev.webOnly, 'web source'),
        ev.trendSignals !== null && plural(ev.trendSignals, 'trend signal'),
        ev.newsletterStories !== null &&
          plural(ev.newsletterStories, 'newsletter story', 'newsletter stories'),
        (ev.screenedOutCount ?? 0) > 0 && `${ev.screenedOutCount} screened out`
      ])
    }
  }
  if (key === 'generating_ideas' && data.ideation) {
    const generated = num(data.ideation.generated)
    const grounded = num(data.ideation.survivedGrounding)
    const selected = num(data.ideation.selected)
    if (generated === null) return { text: null, hover: null }
    return {
      // "5 of 9 ideas": kept of written. An arrow read as a dash at this size.
      text: selected !== null ? `${selected} of ${plural(generated, 'idea')}` : plural(generated, 'idea'),
      hover: joinParts([
        `${generated} written`,
        grounded !== null && `${grounded} passed source checks`,
        selected !== null && `${selected} kept`
      ])
    }
  }
  if (key === 'drafting' && data.drafting > 0) {
    return { text: `${data.drafting} drafting`, hover: null }
  }
  return { text: null, hover: null }
}

/**
 * A folded list inside a card, closed until asked for: a divider row with a
 * title and count, so the card holds no second box.
 */
export function Disclosure({
  title,
  count,
  children
}: {
  title: string
  count?: number
  children: ReactNode
}) {
  return (
    <details className="group border-border border-t">
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-3 [&::-webkit-details-marker]:hidden',
          FOCUS_RING
        )}
      >
        <span className="text-foreground text-[13px] font-medium">
          {title}
          {count !== undefined && (
            <span className="text-muted ml-1.5 font-normal tabular-nums">{count}</span>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className="text-muted h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="pb-3">{children}</div>
    </details>
  )
}

/**
 * What went wrong, in one banner: the run's error, then the failed steps and
 * the goals left without an idea, each folded, with the way out beside them.
 */
export function ProblemsBanner({
  error,
  failedSteps,
  uncoveredGoals,
  action
}: {
  error: string | null
  failedSteps: any[]
  uncoveredGoals: Array<{ goalId: string; goal: string; reason: string }>
  action?: ReactNode
}) {
  // Each list PAGE_SIZE at a time; a page past the end shows the last one.
  const [failedStepPage, setFailedStepPage] = useState(1)
  const [uncoveredGoalPage, setUncoveredGoalPage] = useState(1)
  const failedStepListRef = useRef<HTMLDivElement>(null)
  const tone: Tone = error || failedSteps.length > 0 ? 'danger' : 'warning'
  const t = TONES[tone]
  const steps = paginate(failedSteps, failedStepPage, PAGE_SIZE)
  const goals = paginate(uncoveredGoals, uncoveredGoalPage, PAGE_SIZE)

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-2xl border px-4 py-2', t.border, t.soft)}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <AlertTriangle aria-hidden className={cn('mt-2.5 h-4 w-4 shrink-0', t.text)} />
        <div className="min-w-0 flex-1 [&>details:first-child]:border-t-0">
          {error && (
            <p className="text-foreground py-2 text-[13px] font-medium wrap-break-word">{error}</p>
          )}
          {failedSteps.length > 0 && (
            <Disclosure title="Failed steps" count={failedSteps.length}>
              <div ref={failedStepListRef} className="scroll-mt-4 space-y-3">
                <ul className="space-y-2">
                  {steps.rows.map(step => (
                    <li
                      key={step.id}
                      title={step.requestSummary ?? undefined}
                      className="text-xs wrap-break-word"
                    >
                      <span className="text-foreground font-medium">
                        {STEP_LABELS[step.stage] || step.stage}
                      </span>
                      <span className="text-muted"> · {step.error}</span>
                    </li>
                  ))}
                </ul>
                <Pagination
                  {...steps.pageInfo}
                  noun="failed steps"
                  onPageChange={setFailedStepPage}
                  scrollTarget={failedStepListRef}
                />
              </div>
            </Disclosure>
          )}
          {uncoveredGoals.length > 0 && (
            <Disclosure title="Goals without ideas" count={uncoveredGoals.length}>
              <div className="space-y-3">
                <ul className="space-y-2">
                  {goals.rows.map(g => (
                    <li key={g.goalId} className="text-xs wrap-break-word">
                      <span className="text-foreground font-medium">{g.goal}</span>
                      <span className="text-muted"> · {g.reason}</span>
                    </li>
                  ))}
                </ul>
                <Pagination
                  {...goals.pageInfo}
                  noun="goals"
                  onPageChange={setUncoveredGoalPage}
                />
              </div>
            </Disclosure>
          )}
        </div>
        {action && <div className="py-1">{action}</div>}
      </div>
    </div>
  )
}

/** What a research source was for: plain research, a trend-scan kind, or the knowledge base. */
type SourceKind = 'web' | 'news' | 'trend' | 'conversation' | 'knowledge'
const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  web: 'Web research',
  news: KIND_LABELS.news,
  trend: KIND_LABELS.trend,
  conversation: KIND_LABELS.conversation,
  knowledge: 'Knowledge base'
}
const SOURCE_KINDS = Object.keys(SOURCE_KIND_LABELS) as SourceKind[]

function kindOfFinding(finding: { url?: string | null; provider?: string | null }): SourceKind {
  if (!sourceHost(finding.url)) return 'knowledge'
  return kindOfProvider(finding.provider) ?? 'web'
}

/**
 * What the ideas could draw on: where the evidence came from and how far it
 * can be trusted, the sources themselves, and (folded) the searches behind
 * them and what was screened out.
 */
export function EvidenceSection({
  research,
  findings,
  accountSite
}: {
  research: Record<string, any> | null
  findings: any[]
  accountSite: string | null
}) {
  // The sources, PAGE_SIZE at a time, by kind and search; a change goes back
  // to the first page, and a page past the end shows the last one.
  const [sourcePage, setSourcePage] = useState(1)
  const [sourceKind, setSourceKind] = useState<SourceKind | 'all'>('all')
  const [sourceQuery, setSourceQuery] = useState('')
  const sourceListRef = useRef<HTMLDivElement>(null)
  const newTabNoteId = useId()

  if (!research && findings.length === 0) return null

  const ev = evidenceOf(research)
  const segments: BarSegment[] = [
    { key: 'web', label: 'Web research', value: ev.webOnly ?? 0, tone: 'info' },
    { key: 'trend', label: 'Trend scan', value: ev.trendSignals ?? 0, tone: 'brand' },
    {
      key: 'newsletter',
      label: 'Newsletters',
      value: ev.newsletterItems ?? ev.newsletterStories ?? 0,
      tone: 'warning'
    },
    { key: 'knowledge', label: 'Knowledge base', value: ev.knowledge ?? 0, tone: 'success' },
    { key: 'own', label: 'Your offerings', value: ev.offeringFacts ?? 0, tone: 'neutral' }
  ]
  const hasEvidence = segments.some(s => s.value > 0)
  const mixSegments: BarSegment[] =
    research?.sourceMix && typeof research.sourceMix === 'object'
      ? Object.entries(research.sourceMix as Record<string, unknown>)
          .filter(
            (entry): entry is [string, number] =>
              num(entry[1]) !== null && (entry[1] as number) > 0
          )
          .sort(([a], [b]) => (LABEL_SCORES[b] ?? 50) - (LABEL_SCORES[a] ?? 50))
          .map(([label, value]) => ({
            key: label,
            label,
            value,
            tone: trustTone(LABEL_SCORES[label] ?? 50)
          }))
      : []
  const queries = list(research?.queries).filter((q): q is string => typeof q === 'string')
  const trendQueries = list(research?.trendQueries).filter(
    (q): q is string => typeof q === 'string'
  )
  const screenedOut = list<{ url?: string; title?: string; reason?: string }>(
    research?.screenedOut
  )
  const screenedCount = ev.screenedOutCount ?? screenedOut.length

  const kinds = SOURCE_KINDS.filter(k => findings.some(f => kindOfFinding(f) === k))
  const query = sourceQuery.trim().toLowerCase()
  const shown = findings.filter(
    f =>
      (sourceKind === 'all' || kindOfFinding(f) === sourceKind) &&
      (!query ||
        [f.title, f.snippet, sourceHost(f.url)].some((text: string | null | undefined) =>
          text?.toLowerCase().includes(query)
        ))
  )
  const page = paginate(shown, sourcePage, PAGE_SIZE)

  return (
    <SectionCard
      title="Evidence"
      icon={Search}
      description={
        ev.totalEvidence !== null
          ? `${plural(ev.totalEvidence, 'piece')}${ev.recentEvidence !== null ? ` · ${ev.recentEvidence} recent` : ''}`
          : undefined
      }
    >
      <div className="space-y-6">
        {(hasEvidence || mixSegments.length > 0) && (
          <div className="grid gap-6 lg:grid-cols-2">
            {hasEvidence && (
              <div>
                <h3 className="text-muted mb-2.5 text-xs font-medium">By source</h3>
                <StackedBar segments={segments} label="Evidence by source" />
              </div>
            )}
            {mixSegments.length > 0 && (
              <div>
                <h3 className="text-muted mb-2.5 text-xs font-medium">Trust</h3>
                <StackedBar segments={mixSegments} label="Web sources by credibility" />
              </div>
            )}
          </div>
        )}

        {findings.length > 0 && (
          <div ref={sourceListRef} className="scroll-mt-4 space-y-3">
            <span id={newTabNoteId} className="sr-only">
              Opens in a new tab
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {kinds.length > 1 && (
                <FilterChips
                  label="Show sources by kind"
                  value={sourceKind}
                  onChange={next => {
                    setSourceKind(next)
                    setSourcePage(1)
                  }}
                  className="w-fit max-w-full"
                  options={[
                    { value: 'all' as const, label: 'All' },
                    ...kinds.map(k => ({ value: k, label: SOURCE_KIND_LABELS[k] }))
                  ]}
                />
              )}
              <label className="relative w-full sm:ml-auto sm:w-56">
                <span className="sr-only">Search sources</span>
                <Search
                  aria-hidden
                  className="text-muted pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2"
                />
                <input
                  type="search"
                  value={sourceQuery}
                  onChange={e => {
                    setSourceQuery(e.target.value)
                    setSourcePage(1)
                  }}
                  placeholder="Search"
                  className={cn(
                    FIELD_CLASS,
                    'bg-surface h-8 py-1 pr-2.5 pl-8 text-[13px]'
                  )}
                />
              </label>
            </div>

            {page.rows.length === 0 ? (
              <EmptyState
                compact
                bordered={false}
                icon={SearchX}
                title="No matching sources"
                action={
                  <Button
                    className={FOCUS_RING}
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSourceQuery('')
                      setSourceKind('all')
                      setSourcePage(1)
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <ul className="divide-border divide-y">
                {page.rows.map((f, idx) => (
                  <SourceRow
                    key={f.id ?? idx}
                    finding={f}
                    accountSite={accountSite}
                    newTabNoteId={newTabNoteId}
                  />
                ))}
              </ul>
            )}
            <Pagination
              {...page.pageInfo}
              noun="sources"
              onPageChange={setSourcePage}
              scrollTarget={sourceListRef}
            />
          </div>
        )}

        {(queries.length > 0 || trendQueries.length > 0 || screenedCount > 0) && (
          <div className="border-border border-b">
            {(queries.length > 0 || trendQueries.length > 0) && (
              <Disclosure title="Searches" count={queries.length + trendQueries.length}>
                <div className="space-y-3">
                  {queries.length > 0 && <QueryChips label="Research" queries={queries} />}
                  {trendQueries.length > 0 && (
                    <QueryChips label="Trend scan" queries={trendQueries} />
                  )}
                </div>
              </Disclosure>
            )}
            {screenedCount > 0 && (
              <Disclosure title="Screened out" count={screenedCount}>
                <ul className="divide-border max-h-96 divide-y overflow-y-auto">
                  {screenedOut.map((s, i) => (
                    <li key={`${s.url}-${i}`} className="py-2 text-xs wrap-break-word">
                      {sourceHost(s.url) ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-describedby={newTabNoteId}
                          className={cn('text-foreground rounded font-medium hover:underline', FOCUS_RING)}
                        >
                          {s.title || sourceHost(s.url)}
                        </a>
                      ) : (
                        <span className="text-foreground font-medium">{s.title}</span>
                      )}
                      <span className="text-muted"> · {s.reason}</span>
                    </li>
                  ))}
                </ul>
                {screenedCount > screenedOut.length && screenedOut.length > 0 && (
                  <p className="text-muted pt-2 text-xs tabular-nums">
                    {screenedOut.length} of {screenedCount} shown
                  </p>
                )}
              </Disclosure>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function QueryChips({ label, queries }: { label: string; queries: string[] }) {
  return (
    <div>
      <p className="text-muted mb-1.5 text-xs">{label}</p>
      <ul className="flex flex-wrap gap-1.5">
        {queries.map((q, i) => (
          <li
            key={`${q}-${i}`}
            className="bg-surface-hover text-foreground max-w-full rounded-md px-2 py-1 text-xs wrap-break-word"
          >
            {q}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * One research source: its title and link, its site and how far it can be
 * trusted. What it says, what it was found for and its date are in the hover
 * text.
 */
function SourceRow({
  finding,
  accountSite,
  newTabNoteId
}: {
  finding: {
    url: string
    title?: string | null
    snippet?: string | null
    provider?: string | null
    publishedAt?: string | null
  }
  accountSite?: string | null
  newTabNoteId: string
}) {
  const host = sourceHost(finding.url)
  const rating = host
    ? rateSource({
        url: finding.url,
        origin: 'web',
        ownHosts: ownHosts([accountSite]),
        fromNewsSearch: finding.provider?.startsWith('serper_news')
      })
    : null
  const kind = kindOfProvider(finding.provider)
  const hover =
    joinParts([
      finding.snippet,
      kind ? KIND_LABELS[kind] : null,
      finding.publishedAt ? finding.publishedAt.slice(0, 10) : null,
      rating?.note
    ]) ?? undefined
  return (
    <li className="flex items-start gap-3 py-2.5">
      <ToneDot tone={rating ? trustTone(rating.score) : 'success'} className="mt-1.5" />
      <div className="min-w-0 flex-1 wrap-break-word">
        {host ? (
          <a
            href={finding.url}
            target="_blank"
            rel="noopener noreferrer"
            title={hover}
            aria-describedby={newTabNoteId}
            className={cn('text-foreground rounded text-[13px] font-medium hover:underline', FOCUS_RING)}
          >
            {finding.title || host}
            <ExternalLink aria-hidden className="text-muted ml-1 inline h-3 w-3 align-baseline" />
          </a>
        ) : (
          <p title={hover} className="text-foreground text-[13px] font-medium">
            {finding.title}
          </p>
        )}
        <p className="text-muted text-xs">
          {host ?? SOURCE_KIND_LABELS.knowledge}
          {rating && ` · ${rating.label}`}
        </p>
      </div>
    </li>
  )
}

/**
 * How good the kept ideas are: their average scores and how many each goal
 * got, with the ideas dropped along the way folded below.
 */
export function IdeaQualitySection({ ideation }: { ideation: Record<string, any> }) {
  // The dropped ideas, PAGE_SIZE at a time.
  const [discardedPage, setDiscardedPage] = useState(1)
  const discardedListRef = useRef<HTMLDivElement>(null)

  const perGoal = list<{ goal?: string; ideas?: number; alsoServedBy?: number }>(
    ideation.ideasPerGoal
  )
  const review =
    ideation.goalReview && typeof ideation.goalReview === 'object' ? ideation.goalReview : null
  const reviewed = num(review?.reviewed)
  const missedGoal = num(review?.missedGoal)
  const averages =
    ideation.averageScores && typeof ideation.averageScores === 'object'
      ? (ideation.averageScores as Record<string, unknown>)
      : {}
  const scores = [
    {
      key: 'goalFit',
      label: DIMENSION_LABELS.goalFit,
      value: num(review?.averageGoalFit),
      hover: joinParts([
        reviewed !== null && `${reviewed} reviewed`,
        missedGoal !== null && `${missedGoal} missed their goal`
      ])
    },
    ...JUDGED_DIMENSIONS.map(d => ({
      key: d,
      label: DIMENSION_LABELS[d],
      value: num(averages[d]),
      hover: null
    })),
    {
      key: 'sources',
      label: DIMENSION_LABELS.sources,
      value: num(ideation.averageGroundingScore),
      hover: null
    }
  ].filter(s => s.value !== null) as Array<{
    key: string
    label: string
    value: number
    hover: string | null
  }>
  const discarded = list<{ title?: string; reason?: string }>(ideation.discarded)
  const discardedPaged = paginate(discarded, discardedPage, PAGE_SIZE)

  if (scores.length === 0 && perGoal.length === 0 && discarded.length === 0) return null

  return (
    <SectionCard title="Idea quality" icon={Gauge} description="Averages over the kept ideas, out of 100">
      <div className="space-y-5">
        {(scores.length > 0 || perGoal.length > 0) && (
          <div className="grid gap-6 lg:grid-cols-2">
            {scores.length > 0 && (
              <ul className="space-y-2.5">
                {scores.map(s => (
                  <li
                    key={s.key}
                    title={s.hover ?? undefined}
                    className="grid grid-cols-[minmax(0,10rem)_1fr_2rem] items-center gap-3 text-[13px]"
                  >
                    <span className="text-muted truncate">{s.label}</span>
                    <span aria-hidden className="bg-surface-hover h-1.5 overflow-hidden rounded-full">
                      <span
                        className={cn('block h-full rounded-full', TONES.brand.bar)}
                        style={{ width: `${Math.min(100, Math.max(0, s.value))}%` }}
                      />
                    </span>
                    <span className="text-foreground text-right font-semibold tabular-nums">
                      {s.value}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {perGoal.length > 0 && (
              <div>
                <h3 className="text-muted mb-1 text-xs font-medium">Ideas per goal</h3>
                <ul className="divide-border divide-y">
                  {perGoal.map((g, i) => {
                    const count = num(g.ideas) ?? 0
                    const also = num(g.alsoServedBy) ?? 0
                    return (
                      <li
                        key={`${g.goal}-${i}`}
                        title={also > 0 ? `${also} more also serve it` : undefined}
                        className="flex items-center justify-between gap-3 py-2 text-[13px]"
                      >
                        <span className="text-foreground min-w-0 truncate">{g.goal}</span>
                        <span
                          className={cn(
                            'shrink-0 tabular-nums',
                            count === 0 && also === 0
                              ? cn('font-medium', TONES.warning.text)
                              : 'text-muted'
                          )}
                        >
                          {count}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        {discarded.length > 0 && (
          <div className="border-border border-b">
            <Disclosure title="Discarded" count={discarded.length}>
              <div ref={discardedListRef} className="scroll-mt-4 space-y-3">
                <ul className="space-y-2">
                  {discardedPaged.rows.map((d, i) => (
                    <li key={`${d.title}-${i}`} className="text-xs wrap-break-word">
                      <span className="text-foreground font-medium">{d.title}</span>
                      {d.reason && <span className="text-muted"> · {d.reason}</span>}
                    </li>
                  ))}
                </ul>
                <Pagination
                  {...discardedPaged.pageInfo}
                  noun="discarded ideas"
                  onPageChange={setDiscardedPage}
                  scrollTarget={discardedListRef}
                />
              </div>
            </Disclosure>
          </div>
        )}
      </div>
    </SectionCard>
  )
}
