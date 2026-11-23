'use client'

import { cn } from '@/lib/cn'
import { useEffect, useState } from 'react'

type TocHeading = { id: string; heading: string; level: 2 | 3 }

/** Headings closer than this to the top of the window count as reached. */
const REACHED_PX = 112

/**
 * "On this page": the page's headings, the one being read marked as the
 * window scrolls.
 */
export function DocsToc({ headings }: { headings: TocHeading[] }) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 4
      if (atBottom) {
        setActiveId(headings[headings.length - 1]?.id ?? null)
        return
      }
      let current: string | null = null
      for (const { id } of headings) {
        const element = document.getElementById(id)
        if (element && element.getBoundingClientRect().top <= REACHED_PX)
          current = id
      }
      setActiveId(current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    schedule()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [headings])

  if (headings.length === 0) return null

  return (
    <nav aria-label="On this page">
      <p className="text-foreground mb-3 text-sm font-semibold">On this page</p>
      <ul className="border-border space-y-1 border-l text-sm">
        {headings.map(({ id, heading, level }) => {
          const active = id === activeId
          return (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-current={active ? 'location' : undefined}
                className={cn(
                  '-ml-px block border-l py-1 leading-snug transition-colors',
                  level === 3 ? 'pl-6' : 'pl-3',
                  active
                    ? 'border-brand text-brand-strong font-medium'
                    : 'text-muted hover:text-foreground border-transparent'
                )}
              >
                {heading}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
