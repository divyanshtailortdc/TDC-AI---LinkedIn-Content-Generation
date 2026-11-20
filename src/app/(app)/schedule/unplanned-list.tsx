'use client'

import { buttonClassName } from '@/components/button'
import { Pagination } from '@/components/pagination'
import { PlatformMark } from '@/components/platform-mark'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterChips, type FilterChipOption } from '@/components/ui/filter-chips'
import { SectionCard } from '@/components/ui/section-card'
import { FOCUS_RING, TONES } from '@/components/ui/tone'
import { cn } from '@/lib/cn'
import { PAGE_SIZE, paginate } from '@/lib/pagination'
import { getPlatform } from '@/lib/platforms'
import {
  CalendarCheck2,
  CalendarClock,
  CalendarX,
  GripVertical,
  Search,
  SearchX,
  Target,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useRef, useState, type DragEvent } from 'react'
import { stageOf, STAGE_ORDER, STAGES, type Stage } from './post-stage'
import type { PlannedPost } from './schedule-data'
import { DayInput, QuickMoves, StageChip } from './schedule-parts'

/**
 * Posts not planned yet, newest first: search their hooks, narrow them by
 * stage, and give each a day (a date, Today or Tomorrow, or a drag onto the
 * calendar). A planned post dropped here is unscheduled.
 */
export function UnplannedList({
  posts,
  loaded,
  total,
  platformName,
  today,
  mounted,
  busyId,
  draggingId,
  canDropToUnplan,
  onOpen,
  onPlan,
  onDragStart,
  onDragEnd,
  onDropToUnplan,
  onShowAllPlatforms
}: {
  /** Not planned, of the platform picked above. */
  posts: PlannedPost[]
  /** How many unplanned posts were loaded, before the platform filter. */
  loaded: number
  /** How many there are in all (only the newest are loaded). */
  total: number
  /** The platform picked above, or null for all. */
  platformName: string | null
  today: string | null
  mounted: boolean
  busyId: string | null
  draggingId: string | null
  /** A planned post is being dragged: dropping it here unschedules it. */
  canDropToUnplan: boolean
  onOpen: (id: string) => void
  onPlan: (id: string, day: string | null) => void
  onDragStart: (id: string, e: DragEvent) => void
  onDragEnd: () => void
  onDropToUnplan: (id: string) => void
  onShowAllPlatforms: () => void
}) {
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage | 'all'>('all')
  const [page, setPage] = useState(1)
  const [dropHover, setDropHover] = useState(false)
  const listRef = useRef<HTMLElement>(null)

  const counts = new Map<Stage, number>()
  for (const post of posts) {
    const s = stageOf(post)
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  const present = STAGE_ORDER.filter(s => counts.has(s))
  // A stage picked earlier whose last post was planned since shows them all.
  const shownStage = stage !== 'all' && counts.has(stage) ? stage : 'all'
  const needle = query.trim().toLowerCase()
  const matches = posts.filter(
    post =>
      (shownStage === 'all' || stageOf(post) === shownStage) &&
      (!needle || post.hook.toLowerCase().includes(needle))
  )
  const { rows, pageInfo } = paginate(matches, page, PAGE_SIZE)

  const stageOptions: FilterChipOption<Stage | 'all'>[] = [
    { value: 'all', label: 'All', count: posts.length },
    ...present.map(s => ({
      value: s,
      label: STAGES[s].label,
      count: counts.get(s),
      tone: STAGES[s].tone
    }))
  ]

  /**
   * Plans a row's post. Given a day it leaves the list, so a keyboard user
   * lands on the next post's hook rather than at the top of the page.
   */
  const planRow = (index: number, day: string | null) => {
    const post = rows[index]
    if (!post) return
    const next = rows[index + 1] ?? rows[index - 1]
    const hadFocus = listRef.current?.contains(document.activeElement)
    onPlan(post.id, day)
    if (day && hadFocus && next) {
      requestAnimationFrame(() =>
        listRef.current
          ?.querySelector<HTMLElement>(`[data-post-focus="${CSS.escape(next.id)}"]`)
          ?.focus()
      )
    }
  }

  const clearFilters = () => {
    setQuery('')
    setStage('all')
    setPage(1)
  }

  const footer =
    pageInfo.pageCount > 1 || total > loaded ? (
      <div className="space-y-2">
        {pageInfo.pageCount > 1 && (
          <Pagination
            {...pageInfo}
            noun="posts"
            onPageChange={setPage}
            scrollTarget={listRef}
          />
        )}
        {total > loaded && (
          <p
            className="text-muted text-xs tabular-nums"
            title="Plan these to see older ones."
          >
            Newest {loaded} of {total}
          </p>
        )}
      </div>
    ) : undefined

  return (
    <div
      onDragOver={e => {
        if (!canDropToUnplan) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropHover(true)
      }}
      onDragLeave={e => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDropHover(false)
      }}
      onDrop={e => {
        setDropHover(false)
        if (!canDropToUnplan) return
        e.preventDefault()
        const id = e.dataTransfer.getData('text/plain')
        if (id) onDropToUnplan(id)
      }}
    >
      <SectionCard
        ref={listRef}
        flush
        icon={CalendarClock}
        title={
          <>
            Not planned yet
            <span className="text-muted font-normal tabular-nums">({total})</span>
          </>
        }
        footer={footer}
        className={cn(
          'transition-shadow',
          canDropToUnplan && 'border-brand/40 border-dashed',
          dropHover && 'ring-brand bg-brand/5 ring-2'
        )}
      >
        {canDropToUnplan && (
          <p
            aria-hidden
            className={cn(
              'flex items-center gap-1.5 px-4 pb-3 text-xs font-medium sm:px-5',
              TONES.brand.text
            )}
          >
            <CalendarX className="h-3.5 w-3.5" />
            Drop to unschedule
          </p>
        )}

        {posts.length === 0 ? (
          platformName ? (
            <EmptyState
              compact
              bordered={false}
              icon={CalendarCheck2}
              title={`No ${platformName} posts waiting`}
              action={
                <button
                  type="button"
                  onClick={onShowAllPlatforms}
                  className={buttonClassName({ variant: 'secondary', size: 'sm', className: FOCUS_RING })}
                >
                  Show all
                </button>
              }
            />
          ) : (
            <EmptyState
              compact
              bordered={false}
              icon={CalendarCheck2}
              tone="success"
              title="Every post is planned"
              action={
                <Link
                  href="/ideas"
                  className={buttonClassName({ variant: 'secondary', size: 'sm', className: FOCUS_RING })}
                >
                  Create posts
                </Link>
              }
            />
          )
        ) : (
          <>
            <div className="border-border space-y-2 border-b px-4 pb-3 sm:px-5">
              <div className="relative">
                <Search
                  aria-hidden
                  className="text-muted pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2"
                />
                <input
                  type="search"
                  value={query}
                  onChange={e => {
                    setQuery(e.target.value)
                    setPage(1)
                  }}
                  aria-label="Search posts not planned yet"
                  placeholder="Search hooks"
                  className={cn(
                    'border-border bg-surface-hover/50 text-foreground placeholder:text-muted h-8 w-full rounded-lg border pr-8 pl-8 text-xs [&::-webkit-search-cancel-button]:appearance-none',
                    FOCUS_RING
                  )}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      setPage(1)
                    }}
                    aria-label="Clear search"
                    className={cn(
                      'text-muted hover:text-foreground absolute top-1/2 right-1.5 flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded',
                      FOCUS_RING
                    )}
                  >
                    <X aria-hidden className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {/* Chips only once there is more than one stage to tell apart. */}
              {present.length > 1 && (
                <FilterChips
                  options={stageOptions}
                  value={shownStage}
                  onChange={next => {
                    setStage(next)
                    setPage(1)
                  }}
                  label="Show posts not planned yet by status"
                  className="-m-0.5 border-0 bg-transparent p-0.5"
                />
              )}
            </div>

            {matches.length === 0 ? (
              <EmptyState
                compact
                bordered={false}
                icon={SearchX}
                title="No posts match"
                action={
                  <button
                    type="button"
                    onClick={clearFilters}
                    className={buttonClassName({ variant: 'secondary', size: 'sm', className: FOCUS_RING })}
                  >
                    Clear filters
                  </button>
                }
              />
            ) : (
              <ul
                key={pageInfo.page}
                className="divide-border max-h-128 divide-y overflow-y-auto"
              >
                {rows.map((post, index) => (
                  <li
                    key={post.id}
                    draggable
                    onDragStart={e => onDragStart(post.id, e)}
                    onDragEnd={onDragEnd}
                    className={cn(
                      'group hover:bg-surface-hover/40 space-y-2.5 px-4 py-3.5 transition-colors sm:px-5',
                      draggingId === post.id && 'opacity-40',
                      busyId === post.id && 'opacity-60'
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <button
                        type="button"
                        data-post-focus={post.id}
                        onClick={() => onOpen(post.id)}
                        className={cn(
                          'text-foreground hover:text-brand-strong line-clamp-2 min-w-0 flex-1 cursor-pointer rounded text-left text-[13px] leading-relaxed',
                          FOCUS_RING
                        )}
                      >
                        {post.hook}
                      </button>
                      <GripVertical
                        aria-hidden
                        className="text-muted mt-1 hidden h-3.5 w-3.5 shrink-0 cursor-grab opacity-0 transition-opacity group-hover:opacity-100 md:block"
                      />
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <PlatformMark
                        platform={post.platform}
                        colored
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      <span className="sr-only">{getPlatform(post.platform).name}</span>
                      <StageChip post={post} withTime mounted={mounted} />
                      {post.goalTitle && (
                        <span
                          title={post.goalTitle}
                          className="text-muted inline-flex min-w-0 items-center gap-1 text-xs"
                        >
                          <Target aria-hidden className="h-3 w-3 shrink-0" />
                          <span className="truncate">{post.goalTitle}</span>
                        </span>
                      )}
                    </div>
                    {/* One row: the quick days first, then any other day. */}
                    <div className="flex flex-wrap items-center gap-2">
                      {mounted && today && (
                        <QuickMoves
                          planned={null}
                          today={today}
                          busy={busyId === post.id}
                          onPlan={day => planRow(index, day)}
                          only={['Today', 'Tomorrow']}
                          label={`Plan “${post.hook.slice(0, 40)}” for`}
                        />
                      )}
                      <DayInput
                        label="Plan for"
                        srOnlyLabel
                        value={null}
                        disabled={busyId === post.id}
                        onChange={day => planRow(index, day)}
                        className="min-w-32 flex-1"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SectionCard>
    </div>
  )
}
