import { AppHeaderBar } from '@/components/app-header-bar'

function Bar({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-surface-hover animate-pulse rounded motion-reduce:animate-none ${className}`}
    />
  )
}

/** The Schedule page's shape while it loads: month bar, figures, calendar. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex h-[calc(100vh-4rem)] flex-col">
      <AppHeaderBar>
        <div className="min-w-0 flex-1 space-y-2">
          <Bar className="h-6 w-48" />
          <Bar className="h-3 w-72 max-w-full" />
        </div>
      </AppHeaderBar>

      <div className="flex-1 overflow-hidden p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="space-y-4">
            <Bar className="h-8 w-64" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className={`border-border bg-surface space-y-3 rounded-2xl border p-4 shadow-xs ${i === 0 ? 'col-span-2 sm:col-span-1' : ''}`}
                >
                  <Bar className="h-3 w-16" />
                  <Bar className="h-6 w-10" />
                  <Bar className="h-3 w-24" />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="border-border bg-surface overflow-hidden rounded-2xl border shadow-xs">
              <div className="border-border hidden grid-cols-7 border-b md:grid">
                {Array.from({ length: 35 }, (_, i) => (
                  <div
                    key={i}
                    className="border-border h-28 border-r border-b p-2 [&:nth-child(7n)]:border-r-0"
                  >
                    <Bar className="ml-auto h-3 w-5" />
                  </div>
                ))}
              </div>
              <div className="space-y-3 p-4 md:hidden">
                {Array.from({ length: 4 }, (_, i) => (
                  <Bar key={i} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            </div>
            <div className="border-border bg-surface space-y-3 rounded-2xl border p-5 shadow-xs">
              <Bar className="h-4 w-1/3" />
              <Bar className="h-8 w-full" />
              {Array.from({ length: 4 }, (_, i) => (
                <Bar key={i} className="h-3 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
