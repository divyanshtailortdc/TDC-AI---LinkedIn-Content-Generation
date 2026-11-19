'use client'

import { cn } from '@/lib/cn'
import {
  Children,
  isValidElement,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'

type TabItemProps = { value: string; label?: string; children?: ReactNode }

/**
 * One panel of <Tabs>. Rendered by Tabs, which reads its props; on its own
 * it only shows its content.
 */
export function TabItem({ children }: TabItemProps) {
  return <>{children}</>
}

/**
 * Alternatives side by side, one shown at a time, e.g. the same steps for
 * each platform:
 *
 *   <Tabs>
 *     <TabItem value="linkedin" label="LinkedIn">…</TabItem>
 *     <TabItem value="x" label="X">…</TabItem>
 *   </Tabs>
 */
export function Tabs({
  children,
  defaultValue
}: {
  children?: ReactNode
  defaultValue?: string
}) {
  const items = Children.toArray(children).filter(
    (child): child is React.ReactElement<TabItemProps> =>
      isValidElement<TabItemProps>(child) &&
      typeof child.props.value === 'string'
  )
  const [active, setActive] = useState(
    defaultValue ?? items[0]?.props.value ?? ''
  )
  const id = useId()
  if (items.length === 0) return null

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const step = e.key === 'ArrowRight' ? 1 : -1
    const next = items[(index + step + items.length) % items.length]!
    setActive(next.props.value)
    document.getElementById(`${id}-tab-${next.props.value}`)?.focus()
  }

  return (
    <div className="border-border my-6 overflow-hidden rounded-xl border">
      <div
        role="tablist"
        className="border-border bg-surface flex gap-1 overflow-x-auto border-b px-2 pt-2"
      >
        {items.map((item, index) => {
          const selected = item.props.value === active
          return (
            <button
              key={item.props.value}
              id={`${id}-tab-${item.props.value}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${id}-panel-${item.props.value}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(item.props.value)}
              onKeyDown={e => onKeyDown(e, index)}
              className={cn(
                '-mb-px rounded-t-lg border border-b-0 px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                selected
                  ? 'border-border bg-background text-foreground'
                  : 'text-muted hover:text-foreground border-transparent'
              )}
            >
              {item.props.label ?? item.props.value}
            </button>
          )
        })}
      </div>
      {items.map(item => (
        <div
          key={item.props.value}
          id={`${id}-panel-${item.props.value}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${item.props.value}`}
          hidden={item.props.value !== active}
          className="bg-background px-4 py-1 [&>*:first-child]:mt-3 [&>*:last-child]:mb-3"
        >
          {item.props.children}
        </div>
      ))}
    </div>
  )
}
