import { cn } from '@/lib/cn'
import { KNOWLEDGE_PATH, NEWSLETTER_KNOWLEDGE_PATH } from '@/lib/knowledge-path'
import { FileText, Newspaper } from 'lucide-react'
import Link from 'next/link'

export type KnowledgeView = 'documents' | 'newsletters'

/** ?view= as the Knowledge base reads it: your documents unless it says newsletters. */
export function parseKnowledgeView(
  value: string | string[] | undefined
): KnowledgeView {
  const raw = Array.isArray(value) ? value[0] : value
  return raw === 'newsletters' ? 'newsletters' : 'documents'
}

/**
 * The Knowledge base's two sources: the documents the user adds, which every
 * run reads, and the stories their newsletters bring in, which runs use
 * while they are recent and relevant.
 */
export function KnowledgeViews({
  view,
  documents,
  stories
}: {
  view: KnowledgeView
  documents: number
  stories: number
}) {
  const tabs = [
    {
      key: 'documents',
      href: KNOWLEDGE_PATH,
      label: 'Your documents',
      count: documents,
      icon: FileText
    },
    {
      key: 'newsletters',
      href: NEWSLETTER_KNOWLEDGE_PATH,
      label: 'From newsletters',
      count: stories,
      icon: Newspaper
    }
  ] as const
  return (
    <nav
      aria-label="Knowledge sources"
      className="border-border bg-surface-hover/60 mb-6 inline-flex rounded-xl border p-1"
    >
      {tabs.map(({ key, href, label, count, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={view === key ? 'page' : undefined}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
            view === key
              ? 'bg-surface text-foreground shadow-xs'
              : 'text-muted hover:text-foreground'
          )}
        >
          <Icon aria-hidden className="h-3.5 w-3.5" />
          {label}
          <span className="text-muted tabular-nums">{count}</span>
        </Link>
      ))}
    </nav>
  )
}
