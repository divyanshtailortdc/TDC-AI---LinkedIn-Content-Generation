import { DeleteIdentityDialog } from '@/components/delete-identity-dialog'
import { EditIdentityDialog } from '@/components/edit-identity-dialog'
import { ReactivateIdentityButton } from '@/components/reactivate-identity-button'
import { db } from '@/db'
import {
  accountsTable,
  goalsTable,
  knowledgeDocumentsTable,
  preferencesTable,
  voiceConfigsTable
} from '@/db/schema'
import { getCapabilities } from '@/lib/capabilities'
import {
  AlertCircle,
  Archive,
  BookOpen,
  CheckCircle2,
  Mic,
  Plus,
  SlidersHorizontal,
  Target,
  Users
} from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const [accounts, voiceConfigs, knowledgeDocs, goals, prefs, capabilities] =
    await Promise.all([
      db.select().from(accountsTable),
      db
        .select({ accountId: voiceConfigsTable.accountId })
        .from(voiceConfigsTable),
      db
        .select({ accountId: knowledgeDocumentsTable.accountId })
        .from(knowledgeDocumentsTable),
      db.select({ accountId: goalsTable.accountId }).from(goalsTable),
      db
        .select({ accountId: preferencesTable.accountId })
        .from(preferencesTable),
      Promise.resolve(getCapabilities())
    ])

  const voiceAccountIds = new Set(voiceConfigs.map(vc => vc.accountId))
  const knowledgeAccountIds = new Set(knowledgeDocs.map(kd => kd.accountId))
  const goalAccountIds = new Set(goals.map(g => g.accountId))
  const prefAccountIds = new Set(prefs.map(p => p.accountId))

  const activeAccounts = accounts.filter(a => a.isActive !== false)
  const inactiveAccounts = accounts.filter(a => a.isActive === false)
  const hasAnyAccounts = accounts.length > 0

  return (
    <div className="mx-auto max-w-5xl p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Your LinkedIn content generation workspace
          </p>
        </div>
        {hasAnyAccounts && (
          <Link
            href="/accounts/new"
            className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            <Plus className="h-4 w-4" />
            Add identity
          </Link>
        )}
      </div>

      {/* Capability status panel — always visible */}
      <div className="mb-8 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">
            Capabilities
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Based on the keys present in{' '}
            <code className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[11px]">
              .env.local
            </code>
          </p>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {capabilities.map(cap => (
            <div key={cap.name} className="flex items-center gap-4 px-5 py-4">
              {cap.status === 'live' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--foreground)]">
                  {cap.name}
                </p>
                <p className="text-xs text-[var(--muted)]">{cap.description}</p>
              </div>
              {cap.status === 'live' ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-950/40">
                  Active
                </span>
              ) : (
                <span className="rounded bg-[var(--surface-hover)] px-2 py-0.5 font-mono text-xs text-[var(--muted)]">
                  {cap.missingKey} not set
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Empty state / Account list */}
      {!hasAnyAccounts ? (
        <EmptyState />
      ) : (
        <AccountList
          activeAccounts={activeAccounts}
          inactiveAccounts={inactiveAccounts}
          voiceAccountIds={voiceAccountIds}
          knowledgeAccountIds={knowledgeAccountIds}
          goalAccountIds={goalAccountIds}
          prefAccountIds={prefAccountIds}
        />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)] py-20">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/10">
        <Users className="h-7 w-7 text-[var(--accent)]" />
      </div>
      <h2 className="mb-2 text-lg font-semibold text-[var(--foreground)]">
        Add your first LinkedIn identity
      </h2>
      <p className="mb-8 max-w-sm text-center text-sm leading-relaxed text-[var(--muted)]">
        An identity is a persona you want to generate content for — yourself,
        your company, or a product. Each one gets its own voice, knowledge base,
        and goals.
      </p>
      <Link
        href="/accounts/new"
        className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
      >
        <Plus className="h-4 w-4" />
        Add your first identity
      </Link>
    </div>
  )
}

type Account = typeof accountsTable.$inferSelect

const setupSteps = [
  { key: 'voice', label: 'Voice', icon: Mic },
  { key: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { key: 'goals', label: 'Goals', icon: Target },
  { key: 'preferences', label: 'Preferences', icon: SlidersHorizontal }
]

function AccountList({
  activeAccounts,
  inactiveAccounts,
  voiceAccountIds,
  knowledgeAccountIds,
  goalAccountIds,
  prefAccountIds
}: {
  activeAccounts: Account[]
  inactiveAccounts: Account[]
  voiceAccountIds: Set<string>
  knowledgeAccountIds: Set<string>
  goalAccountIds: Set<string>
  prefAccountIds: Set<string>
}) {
  return (
    <div className="space-y-8">
      {/* Active Identities */}
      <div>
        <h2 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
          Identities ({activeAccounts.length})
        </h2>
        {activeAccounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
            No active identities. You can reactivate an existing one below or add a new identity.
          </div>
        ) : (
          <div className="space-y-4">
            {activeAccounts.map(account => (
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

      {/* Inactive Identities Section */}
      {inactiveAccounts.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/50 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-[var(--muted)]" />
              <h3 className="text-sm font-semibold text-[var(--foreground)]">
                Deactivated Identities ({inactiveAccounts.length})
              </h3>
            </div>
            <span className="text-xs text-[var(--muted)]">
              Data safely preserved • Can be reactivated anytime
            </span>
          </div>
          <div className="space-y-3">
            {inactiveAccounts.map(account => (
              <InactiveAccountCard key={account.id} account={account} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function InactiveAccountCard({ account }: { account: Account }) {
  const initials = account.name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 transition-colors hover:border-[var(--accent)]/30">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-hover)] text-xs font-semibold text-[var(--muted)]">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--foreground)]">
              {account.name}
            </span>
            <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              Inactive
            </span>
            <span className="shrink-0 rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] text-[var(--muted)] capitalize">
              {account.accountType}
            </span>
          </div>
          {account.headline && (
            <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
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

function AccountCard({
  account,
  hasVoice,
  hasKnowledge,
  hasGoals,
  hasPreferences
}: {
  account: Account
  hasVoice: boolean
  hasKnowledge: boolean
  hasGoals: boolean
  hasPreferences: boolean
}) {
  const initials = account.name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const completed: Record<string, boolean> = {
    voice: hasVoice,
    knowledge: hasKnowledge,
    goals: hasGoals,
    preferences: hasPreferences
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)]/40">
      {/* Account header */}
      <div className="mb-5 flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-semibold text-white">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/accounts/${account.id}`}
              className="truncate font-semibold text-[var(--foreground)] transition-colors hover:text-[var(--accent)]"
            >
              {account.name}
            </Link>
            <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              Active
            </span>
            <span className="shrink-0 rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-[var(--muted)] capitalize">
              {account.accountType}
            </span>
          </div>
          <p className="mt-0.5 truncate text-sm text-[var(--muted)]">
            {account.headline}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <EditIdentityDialog account={account} />
          <span className="h-3 w-px bg-[var(--border)]" />
          <DeleteIdentityDialog
            accountId={account.id}
            accountName={account.name}
          />
        </div>
      </div>

      {/* Setup checklist */}
      <div>
        <p className="mb-3 text-xs font-medium tracking-wide text-[var(--muted)] uppercase">
          Setup checklist
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {setupSteps.map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              href={`/accounts/${account.id}/${key}`}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                completed[key]
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                  : 'bg-[var(--surface-hover)] text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {completed[key] ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              ) : (
                <span className="inline-block h-3 w-3 rounded-full border border-[var(--border)]" />
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
