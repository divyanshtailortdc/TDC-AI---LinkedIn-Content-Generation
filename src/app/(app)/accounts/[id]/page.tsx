import { AccountHeader } from '@/components/account-header'
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
import { eq } from 'drizzle-orm'
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
        where: eq(offeringsTable.accountId, id)
      }),
      db.query.audiencesTable.findMany({
        where: eq(audiencesTable.accountId, id)
      })
    ])

  const allDone = Boolean(voiceConfig && knowledgeDoc && goal && preference)

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <AccountHeader account={account} />
      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Setup Complete Banner */}
          {allDone && (
            <div className="flex flex-col justify-between gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-50/60 p-5 sm:flex-row sm:items-center dark:bg-emerald-950/20">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
                  <Sparkles className="h-5 w-5" />
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
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Generate Now</span>
              </Link>
            </div>
          )}

          {/* Edit LinkedIn Identity & Core Identity */}
          <EditIdentityForm
            account={account}
            initialOfferings={offerings}
            initialAudiences={audiences}
          />
        </div>
      </div>
    </div>
  )
}
