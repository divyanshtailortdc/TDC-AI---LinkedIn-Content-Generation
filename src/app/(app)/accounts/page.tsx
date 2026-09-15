import { ReactivateIdentityButton } from '@/components/reactivate-identity-button'
import {
  Archive,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Mic,
  Play,
  Plus,
  SlidersHorizontal,
  Target,
  Users
} from 'lucide-react'
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

export const dynamic = 'force-dynamic'

type Account = typeof accountsTable.$inferSelect

const setupSteps = [
  { key: 'voice', label: 'Voice', icon: Mic, href: 'voice' },
  { key: 'knowledge', label: 'Knowledge', icon: BookOpen, href: 'knowledge' },
  { key: 'goals', label: 'Goals', icon: Target, href: 'goals' },
  { key: 'preferences', label: 'Preferences', icon: SlidersHorizontal, href: 'preferences' },
]

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

  const activeAccounts = accounts.filter((a) => a.isActive !== false)
  const inactiveAccounts = accounts.filter((a) => a.isActive === false)
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

      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="max-w-5xl mx-auto space-y-8">

      {!hasAnyAccounts ? (
        <EmptyState />
      ) : (
        <>
          {/* Active Identities */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-4">
              Identities ({activeAccounts.length})
            </p>
            {activeAccounts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted bg-surface">
                No active identities. You can reactivate an existing one below or add a new identity.
              </div>
            ) : (
              <div className="space-y-4">
                {activeAccounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    hasVoice={voiceAccountIds.has(account.id)}
                    hasKnowledge={knowledgeAccountIds.has(account.id)}
                    hasGoals={goalAccountIds.has(account.id)}
                    hasPreferences={prefAccountIds.has(account.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Inactive Identities */}
          {inactiveAccounts.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface/50 p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Archive className="h-4 w-4 text-muted" />
                  <h3 className="text-sm font-semibold text-foreground">
                    Deactivated Identities ({inactiveAccounts.length})
                  </h3>
                </div>
                <span className="text-xs text-muted">
                  Data safely preserved • Can be reactivated anytime
                </span>
              </div>
              <div className="space-y-3">
                {inactiveAccounts.map((account) => (
                  <InactiveAccountCard key={account.id} account={account} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
        </div>
      </div>
    </div>
  )
}

function InactiveAccountCard({ account }: { account: Account }) {
  const initials = account.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-accent/30">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-muted">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {account.name}
            </span>
            <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              Inactive
            </span>
            <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-muted capitalize">
              {account.accountType}
            </span>
          </div>
          {account.headline && (
            <p className="mt-0.5 truncate text-xs text-muted">
              {account.headline}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ReactivateIdentityButton
          accountId={account.id}
          accountName={account.name}
        />
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 rounded-xl border-2 border-dashed border-border bg-surface">
      <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-5">
        <Users className="w-7 h-7 text-accent" />
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-2">
        No identities yet
      </h2>
      <p className="text-sm text-muted text-center max-w-sm mb-8 leading-relaxed">
        An identity is a persona you want to generate content for — yourself, your company, or a
        product. Each one gets its own voice, knowledge base, and goals.
      </p>
      <Link
        href="/accounts/new"
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-background text-sm font-medium transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add your first identity
      </Link>
    </div>
  )
}

function AccountCard({
  account,
  hasVoice,
  hasKnowledge,
  hasGoals,
  hasPreferences,
}: {
  account: Account
  hasVoice: boolean
  hasKnowledge: boolean
  hasGoals: boolean
  hasPreferences: boolean
}) {
  const initials = account.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const completed: Record<string, boolean> = {
    voice: hasVoice,
    knowledge: hasKnowledge,
    goals: hasGoals,
    preferences: hasPreferences,
  }

  const completedCount = Object.values(completed).filter(Boolean).length
  const allDone = completedCount === setupSteps.length

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden hover:border-accent/40 transition-colors">
      {/* Account top row */}
      <div className="flex items-start gap-4 p-5 border-b border-border">
        <div className="w-11 h-11 rounded-full bg-accent text-background font-semibold text-sm flex items-center justify-center shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground">{account.name}</h3>
            <span className="text-xs capitalize text-muted bg-surface-hover px-2 py-0.5 rounded-full shrink-0">
              {account.accountType}
            </span>
            <span className="text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full shrink-0">
              Active
            </span>
            {allDone ? (
              <span className="text-xs text-emerald-600 font-medium bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Ready
              </span>
            ) : (
              <span className="text-xs text-muted bg-surface-hover px-2 py-0.5 rounded-full shrink-0">
                {completedCount}/{setupSteps.length} setup
              </span>
            )}
          </div>
          {account.headline && (
            <p className="text-sm text-muted truncate mt-0.5">{account.headline}</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {allDone && (
            <Link
              href={`/accounts/${account.id}/runs`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              <Play className="w-3 h-3 fill-current" />
              Generate
            </Link>
          )}
          <Link
            href={`/accounts/${account.id}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
          >
            Open
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Setup checklist row */}
      <div className="px-5 py-3.5 flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-muted uppercase tracking-wide mr-1">
          Setup:
        </span>
        {setupSteps.map(({ key, label, icon: Icon, href }) => (
          <Link
            key={key}
            href={`/accounts/${account.id}/${href}`}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              completed[key]
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                : 'bg-surface-hover text-muted hover:text-foreground'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {completed[key] ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            ) : (
              <span className="w-3 h-3 rounded-full border border-border inline-block" />
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
