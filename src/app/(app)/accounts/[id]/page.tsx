import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { Mic, BookOpen, Target, SlidersHorizontal, ChevronRight, ArrowLeft } from 'lucide-react'

export default async function AccountPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, id)
  })

  if (!account) notFound()

  const initials = account.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const setupSteps = [
    {
      key: 'voice',
      label: 'Voice',
      description: 'Teach the AI how you sound',
      icon: Mic,
      href: `/accounts/${id}/voice`,
      done: false
    },
    {
      key: 'knowledge',
      label: 'Knowledge base',
      description: 'Add URLs and notes as grounded sources',
      icon: BookOpen,
      href: `/accounts/${id}/knowledge`,
      done: false
    },
    {
      key: 'goals',
      label: 'Goals',
      description: 'Set what each post campaign should achieve',
      icon: Target,
      href: `/accounts/${id}/goals`,
      done: false
    },
    {
      key: 'preferences',
      label: 'Preferences',
      description: 'Set cadence, pillars, and media policy',
      icon: SlidersHorizontal,
      href: `/accounts/${id}/preferences`,
      done: false
    },
  ]

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Back */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Dashboard
      </Link>

      {/* Identity header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-14 h-14 rounded-full bg-[var(--accent)] text-white font-bold text-lg flex items-center justify-center shrink-0">
          {initials}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[var(--foreground)]">{account.name}</h1>
            <span className="text-xs capitalize bg-[var(--surface-hover)] text-[var(--muted)] px-2 py-0.5 rounded-full">
              {account.accountType}
            </span>
          </div>
          <p className="text-sm text-[var(--muted)] mt-0.5">{account.headline}</p>
          {account.websiteUrl && (
            <a
              href={account.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--accent)] hover:underline mt-0.5 block"
            >
              {account.websiteUrl}
            </a>
          )}
        </div>
      </div>

      {/* Setup checklist */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Setup checklist</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Complete these steps to enable content generation
          </p>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {setupSteps.map(({ key, label, description, icon: Icon, href, done }) => (
            <Link
              key={key}
              href={href}
              className="flex items-center gap-4 px-5 py-4 hover:bg-[var(--surface-hover)] transition-colors group"
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                done
                  ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600'
                  : 'bg-[var(--surface-hover)] text-[var(--muted)] group-hover:bg-[var(--accent)]/10 group-hover:text-[var(--accent)]'
              }`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--foreground)]">{label}</p>
                <p className="text-xs text-[var(--muted)]">{description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {done ? (
                  <span className="text-xs text-emerald-600 font-medium">Done</span>
                ) : (
                  <span className="text-xs text-[var(--muted)]">Not started</span>
                )}
                <ChevronRight className="w-4 h-4 text-[var(--muted)]" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
