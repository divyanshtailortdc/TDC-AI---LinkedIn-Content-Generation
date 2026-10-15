import { SetupShell } from '@/components/account-setup/setup-shell'
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
import { Play, Sparkles } from 'lucide-react'
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
        <div className="mb-6 flex flex-col justify-between gap-4 rounded-xl border border-emerald-500/30 bg-emerald-50/60 px-4 py-3 sm:flex-row sm:items-center dark:bg-emerald-950/20">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
              <Sparkles className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-emerald-950 dark:text-emerald-200">
                Setup Complete — Ready to Generate!
              </h3>
              <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                Voice, knowledge base, goals, and preferences are fully
                configured.
              </p>
            </div>
          </div>
          <Link
            href={`/accounts/${id}/runs`}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>Generate Now</span>
          </Link>
        </div>
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
