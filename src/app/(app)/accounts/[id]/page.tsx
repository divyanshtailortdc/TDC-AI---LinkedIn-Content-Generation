import { AccountHeader } from '@/components/account-header'
import { db } from '@/db'
import {
  accountsTable,
  voiceConfigsTable,
  knowledgeDocumentsTable,
  goalsTable,
  preferencesTable,
  offeringsTable,
  audiencesTable
} from '@/db/schema'
import { eq } from 'drizzle-orm'
import { BookOpen, ChevronRight, Mic, SlidersHorizontal, Target } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EditIdentityForm } from './edit-identity-form'

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

  const [
    voiceConfig,
    knowledgeDoc,
    goal,
    preference,
    offerings,
    audiences
  ] = await Promise.all([
    db.query.voiceConfigsTable.findFirst({
      where: eq(voiceConfigsTable.accountId, id)
    }),
    db.query.knowledgeDocumentsTable.findFirst({
      where: eq(knowledgeDocumentsTable.accountId, id)
    }),
    db.query.goalsTable.findFirst({
      where: eq(goalsTable.accountId, id)
    }),
    db.query.preferencesTable.findFirst({
      where: eq(preferencesTable.accountId, id)
    }),
    db.query.offeringsTable.findMany({
      where: eq(offeringsTable.accountId, id)
    }),
    db.query.audiencesTable.findMany({
      where: eq(audiencesTable.accountId, id)
    })
  ])

  const setupSteps = [
    {
      key: 'voice',
      label: 'Voice',
      description: 'Teach the AI how you sound',
      icon: Mic,
      href: `/accounts/${id}/voice`,
      done: Boolean(voiceConfig)
    },
    {
      key: 'knowledge',
      label: 'Knowledge base',
      description: 'Add URLs and notes as grounded sources',
      icon: BookOpen,
      href: `/accounts/${id}/knowledge`,
      done: Boolean(knowledgeDoc)
    },
    {
      key: 'goals',
      label: 'Goals',
      description: 'Set what each post campaign should achieve',
      icon: Target,
      href: `/accounts/${id}/goals`,
      done: Boolean(goal)
    },
    {
      key: 'preferences',
      label: 'Preferences',
      description: 'Set cadence, pillars, and media policy',
      icon: SlidersHorizontal,
      href: `/accounts/${id}/preferences`,
      done: Boolean(preference)
    },
  ]

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <AccountHeader account={account} />

      {/* Setup checklist summary */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Setup checklist</h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Complete these steps to enable fine-tuned content generation
            </p>
          </div>
          <span className="text-xs font-medium text-[var(--muted)] bg-[var(--surface-hover)] px-2.5 py-1 rounded-full">
            {setupSteps.filter(s => s.done).length} of {setupSteps.length} complete
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x border-[var(--border)]">
          {setupSteps.map(({ key, label, description, icon: Icon, href, done }) => (
            <Link
              key={key}
              href={href}
              className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-[var(--surface-hover)] transition-colors group border-b border-[var(--border)] last:border-b-0"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                done
                  ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600'
                  : 'bg-[var(--surface-hover)] text-[var(--muted)] group-hover:bg-[var(--accent)]/10 group-hover:text-[var(--accent)]'
              }`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[var(--foreground)]">{label}</p>
                  {done ? (
                    <span className="text-[11px] text-emerald-600 font-medium">Done</span>
                  ) : (
                    <span className="text-[11px] text-[var(--muted)]">Not started</span>
                  )}
                </div>
                <p className="text-[11px] text-[var(--muted)] truncate">{description}</p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
            </Link>
          ))}
        </div>
      </div>

      {/* Edit LinkedIn Identity & Core Identity */}
      <EditIdentityForm
        account={account}
        initialOfferings={offerings}
        initialAudiences={audiences}
      />
    </div>
  )
}
