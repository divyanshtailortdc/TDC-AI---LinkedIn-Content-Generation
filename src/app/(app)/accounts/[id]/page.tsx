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
import { BookOpen, ChevronRight, Mic, SlidersHorizontal, Target, Play, Sparkles } from 'lucide-react'
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

  const allDone = Boolean(voiceConfig && knowledgeDoc && goal && preference)

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8 space-y-6">
      <AccountHeader account={account} />

      {/* Setup Complete Banner */}
      {allDone && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-950/20 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-emerald-950 dark:text-emerald-200">
                Setup Complete — Ready to Generate!
              </h3>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                Voice, knowledge base, goals, and preferences are fully configured.
              </p>
            </div>
          </div>
          <Link
            href={`/accounts/${id}/runs`}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Generate Now</span>
          </Link>
        </div>
      )}

      {/* Setup checklist */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Setup checklist</h2>
            <p className="text-xs text-muted mt-0.5">
              Complete these steps to enable fine-tuned content generation
            </p>
          </div>
          <span className="text-xs font-medium text-muted bg-surface-hover px-2.5 py-1 rounded-full">
            {setupSteps.filter(s => s.done).length} of {setupSteps.length} complete
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x border-border">
          {setupSteps.map(({ key, label, description, icon: Icon, href, done }) => (
            <Link
              key={key}
              href={href}
              className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-surface-hover transition-colors group border-b border-border last:border-b-0"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                done
                  ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600'
                  : 'bg-surface-hover text-muted group-hover:bg-accent/10 group-hover:text-accent'
              }`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">{label}</p>
                  {done ? (
                    <span className="text-[11px] text-emerald-600 font-medium">Done</span>
                  ) : (
                    <span className="text-[11px] text-muted">Not started</span>
                  )}
                </div>
                <p className="text-[11px] text-muted truncate">{description}</p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-muted shrink-0" />
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
