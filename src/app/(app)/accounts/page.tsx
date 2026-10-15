import { Plus } from 'lucide-react'
import Link from 'next/link'
import { db } from '@/db'
import {
  accountsTable,
  goalsTable,
  knowledgeDocumentsTable,
  preferencesTable,
  voiceConfigsTable
} from '@/db/schema'
import { PageHeader } from '@/components/page-header'
import { AccountsClient } from './accounts-client'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  const [accounts, voiceConfigs, knowledgeDocs, goals, prefs] = await Promise.all([
    db.select().from(accountsTable),
    db.select({ accountId: voiceConfigsTable.accountId }).from(voiceConfigsTable),
    db.select({ accountId: knowledgeDocumentsTable.accountId }).from(knowledgeDocumentsTable),
    db.select({ accountId: goalsTable.accountId }).from(goalsTable),
    db.select({ accountId: preferencesTable.accountId }).from(preferencesTable),
  ])

  const voiceAccountIds = new Set(voiceConfigs.map((vc) => vc.accountId))
  const knowledgeAccountIds = new Set(knowledgeDocs.map((kd) => kd.accountId))
  const goalAccountIds = new Set(goals.map((g) => g.accountId))
  const prefAccountIds = new Set(prefs.map((p) => p.accountId))

  const hasAnyAccounts = accounts.length > 0

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <PageHeader
        title="Accounts"
        description="Manage your LinkedIn identities and their configurations"
        actions={
          hasAnyAccounts ? (
            <Link
              href="/accounts/new"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-background text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add identity
            </Link>
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-surface-hover/30">
        <div className="mx-auto space-y-8">
          <AccountsClient
            accounts={accounts}
            voiceAccountIds={voiceAccountIds}
            knowledgeAccountIds={knowledgeAccountIds}
            goalAccountIds={goalAccountIds}
            prefAccountIds={prefAccountIds}
          />
        </div>
      </div>
    </div>
  )
}
