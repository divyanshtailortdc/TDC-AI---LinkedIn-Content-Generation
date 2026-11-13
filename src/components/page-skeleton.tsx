import { AppHeaderBar } from '@/components/app-header-bar'

/**
 * What a route shows while its data loads (its loading.tsx). Every page here
 * renders on the server on each visit, and Next prefetches such a route only
 * when it has a loading file: with one, a click paints this at once and the
 * page streams in after it; without, the click waited for the slowest query
 * with nothing on screen.
 *
 * Drawn in the page's own frame (the shared header bar, the page's columns)
 * so the swap to the real page does not jump.
 */

type Layout =
  | 'list'
  | 'split'
  | 'stages'
  | 'calendar'
  // The Posts list and a post's page: full width, 16px in (24px from sm).
  | 'posts'
  | 'post'

function Bar({ className = '' }: { className?: string }) {
  return <div className={`bg-surface-hover animate-pulse rounded ${className}`} />
}

function Card({ lines = 2 }: { lines?: number }) {
  return (
    <div className="border-border bg-surface space-y-3 rounded-2xl border p-5 shadow-xs">
      <Bar className="h-4 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Bar key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  )
}

export function PageSkeleton({ layout = 'list' }: { layout?: Layout }) {
  const fullWidth = layout === 'posts' || layout === 'post'
  return (
    <div
      role="status"
      aria-label="Loading"
      // The full-width pages fill the app's main area, as they do loaded.
      className={
        fullWidth
          ? 'flex min-h-0 flex-1 flex-col'
          : 'flex h-[calc(100vh-4rem)] flex-col'
      }
    >
      {/* The Posts list draws its title in the page, not in the bar. */}
      {layout !== 'posts' && (
        <AppHeaderBar>
          <div className="min-w-0 flex-1 space-y-2">
            <Bar className="h-6 w-48" />
            <Bar className="h-3 w-72 max-w-full" />
          </div>
        </AppHeaderBar>
      )}

      {fullWidth ? (
        <div
          className={`@container min-h-0 flex-1 overflow-hidden ${layout === 'posts' ? 'px-4 pt-4 pb-6 sm:px-6' : 'px-4 py-4 sm:px-6'}`}
        >
          {layout === 'posts' ? (
            // Title, platform tabs, the status and tools row, then cards in
            // the list's own columns.
            <div className="space-y-4">
              <div className="space-y-2 pt-2">
                <Bar className="h-8 w-40" />
                <Bar className="h-4 w-lg max-w-full" />
              </div>
              <Bar className="h-8 w-xl max-w-full" />
              <Bar className="h-10 w-full" />
              <Bar className="h-4 w-64" />
              <div className="grid grid-cols-1 gap-4 pt-2 @xl:grid-cols-2 @min-[54rem]:grid-cols-3 @min-[68rem]:grid-cols-4 @min-[92rem]:grid-cols-5">
                {Array.from({ length: 6 }, (_, i) => (
                  <div
                    key={i}
                    className="border-border bg-surface space-y-3 rounded-2xl border p-4 shadow-xs"
                  >
                    <Bar className="h-5 w-1/2" />
                    <Bar className="aspect-5/2 w-full rounded-lg" />
                    <Bar className="h-4 w-4/5" />
                    <Bar className="h-3 w-full" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            // The post's preview beside its image.
            <div className="grid grid-cols-1 items-start gap-x-6 gap-y-3 @3xl:grid-cols-[minmax(0,1fr)_clamp(18rem,32%,32rem)] @6xl:gap-x-8">
              <div className="min-w-0 space-y-3">
                <Bar className="h-8 w-64 max-w-full" />
                <div className="mx-auto w-full max-w-4xl">
                  <Card lines={8} />
                </div>
              </div>
              <div className="min-w-0 space-y-3">
                <Bar className="h-8 w-24" />
                <Card lines={4} />
              </div>
            </div>
          )}
        </div>
      ) : layout === 'split' ? (
        // The posts queue beside the post under review.
        <div className="flex flex-1 overflow-hidden">
          <aside className="border-border bg-surface hidden w-[320px] shrink-0 flex-col gap-3 border-r p-4 lg:flex">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2 py-1">
                <Bar className="h-3.5 w-4/5" />
                <Bar className="h-3 w-1/2" />
              </div>
            ))}
          </aside>
          <div className="flex-1 overflow-hidden p-4 sm:p-6">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
              <div className="space-y-4 lg:col-span-7">
                <Card lines={6} />
              </div>
              <div className="space-y-4 lg:col-span-5">
                <Card lines={3} />
                <Card lines={2} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden p-4 sm:p-6">
          <div className="mx-auto max-w-7xl space-y-6">
            {layout === 'calendar' ? (
              <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="border-border bg-surface overflow-hidden rounded-2xl border shadow-xs">
                  <div className="border-border border-b px-3 py-3">
                    <Bar className="h-4 w-40" />
                  </div>
                  <div className="grid grid-cols-7">
                    {Array.from({ length: 35 }, (_, i) => (
                      <div key={i} className="border-border h-20 border-r border-b p-2 sm:h-24">
                        <Bar className="h-3 w-5" />
                      </div>
                    ))}
                  </div>
                </div>
                <Card lines={4} />
              </div>
            ) : layout === 'stages' ? (
              // A run: its stages, then its ideas.
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="border-border bg-surface space-y-2 rounded-xl border p-4">
                      <Bar className="h-4 w-2/3" />
                      <Bar className="h-3 w-1/3" />
                    </div>
                  ))}
                </div>
                {Array.from({ length: 3 }, (_, i) => (
                  <Card key={i} lines={3} />
                ))}
              </>
            ) : (
              Array.from({ length: 4 }, (_, i) => <Card key={i} />)
            )}
          </div>
        </div>
      )}
    </div>
  )
}
