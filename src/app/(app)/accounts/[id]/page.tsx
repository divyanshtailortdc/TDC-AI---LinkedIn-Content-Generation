import { SetupShell } from '@/components/account-setup/setup-shell'
import { SETUP_STEPS } from '@/components/account-setup/steps'
import { db } from '@/db'
import {
  accountsTable,
  audiencesTable,
  goalsTable,
  knowledgeDocumentsTable,
  offeringsTable,
  preferencesTable,
  voiceConfigsTable
} from '@/db/schema'
import { asc, eq } from 'drizzle-orm'
import { ArrowRight, Check, Play, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EditIdentityForm } from './edit-identity-form'

/** The steps whose saved data makes the account ready to generate. */
const CONFIGURED_STEPS = SETUP_STEPS.filter(step =>
  ['voice', 'knowledge', 'goals', 'preferences'].includes(step.key)
)

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

  const [voiceConfig, knowledgeDoc, goal, preference, offerings, audiences] =
    await Promise.all([
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
        where: eq(offeringsTable.accountId, id),
        orderBy: [asc(offeringsTable.createdAt)]
      }),
      db.query.audiencesTable.findMany({
        where: eq(audiencesTable.accountId, id),
        orderBy: [asc(audiencesTable.createdAt)]
      })
    ])

  const allDone = Boolean(voiceConfig && knowledgeDoc && goal && preference)

  return (
    <SetupShell account={account} hasSavedData>
      {/* Setup Complete Banner */}
      {allDone && (
        <section className="border-border bg-surface relative mb-6 overflow-hidden rounded-xl border shadow-xs">
          <div aria-hidden className="bg-brand absolute inset-y-0 left-0 w-1" />
          <div className="flex flex-col gap-4 p-4 pl-5 sm:flex-row sm:items-center sm:justify-between sm:p-5 sm:pl-6">
            <div className="flex min-w-0 items-start gap-3.5">
              <div className="bg-brand/15 text-brand-strong flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-foreground text-sm leading-tight font-semibold sm:text-base">
                  Setup Complete — Ready to Generate!
                </h3>
                <p className="text-muted mt-1 text-xs">Fully configured:</p>
                {/* Each chip opens its step, so a tweak is one click away. */}
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {CONFIGURED_STEPS.map(step => (
                    <li key={step.key}>
                      <Link
                        href={`/accounts/${id}${step.path}`}
                        className="border-border text-foreground hover:bg-surface-hover inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
                      >
                        <Check className="text-brand-strong h-3.5 w-3.5" />
                        {step.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <Link
              href={`/accounts/${id}/runs`}
              className="bg-accent hover:bg-accent-hover text-background inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold whitespace-nowrap shadow-sm transition-colors"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>Generate Now</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      )}

      {/* Edit LinkedIn Identity & Core Identity */}
      {/* key={account.id}: the form seeds its fields into local useState,
              which only runs on mount, so switching to a different account's
              settings must remount it rather than reuse stale field values. */}
      <EditIdentityForm
        key={account.id}
        account={account}
        initialOfferings={offerings}
        initialAudiences={audiences}
      />
    </SetupShell>
  )
}
