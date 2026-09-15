import { DeleteIdentityDialog } from '@/components/delete-identity-dialog'
import { EditIdentityDialog } from '@/components/edit-identity-dialog'
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
  const hasAccounts = accounts.length > 0

  return (
    <div className="mx-auto max-w-5xl p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            Your LinkedIn content generation workspace
          </p>
        </div>
        {hasAccounts && (
          <Link
            href="/accounts/new"
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            Add identity
          </Link>
        )}
      </div>

      {/* Capability status panel — always visible */}
      <div className="mb-8 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            Capabilities
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Based on the keys present in{' '}
            <code className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[11px]">
              .env.local
            </code>
          </p>
        </div>
        <div className="divide-y divide-border">
          {capabilities.map(cap => (
            <div key={cap.name} className="flex items-center gap-4 px-5 py-4">
              {cap.status === 'live' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {cap.name}
                </p>
                <p className="text-xs text-muted">{cap.description}</p>
              </div>
              {cap.status === 'live' ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-950/40">
                  Active
                </span>
              ) : (
                <span className="rounded bg-surface-hover px-2 py-0.5 font-mono text-xs text-muted">
                  {cap.missingKey} not set
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Empty state / Account list */}
      {!hasAccounts ? (
        <EmptyState />
      ) : (
        <AccountList
          accounts={accounts}
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
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-surface py-20">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10">
        <Users className="h-7 w-7 text-accent" />
      </div>
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Add your first LinkedIn identity
      </h2>
      <p className="mb-8 max-w-sm text-center text-sm leading-relaxed text-muted">
        An identity is a persona you want to generate content for — yourself,
        your company, or a product. Each one gets its own voice, knowledge base,
        and goals.
      </p>
      <Link
        href="/accounts/new"
        className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-accent-hover"
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
  accounts,
  voiceAccountIds,
  knowledgeAccountIds,
  goalAccountIds,
  prefAccountIds
}: {
  accounts: Account[]
  voiceAccountIds: Set<string>
  knowledgeAccountIds: Set<string>
  goalAccountIds: Set<string>
  prefAccountIds: Set<string>
}) {
  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-foreground">
        Identities ({accounts.length})
      </h2>
      <div className="space-y-4">
        {accounts.map(account => (
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
    <div className="rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent/40">
      {/* Account header */}
      <div className="mb-5 flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-background">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/accounts/${account.id}`}
              className="truncate font-semibold text-foreground transition-colors hover:text-accent"
            >
              {account.name}
            </Link>
            <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-xs text-muted capitalize">
              {account.accountType}
            </span>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">
            {account.headline}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <EditIdentityDialog account={account} />
          <span className="h-3 w-px bg-border" />
          <DeleteIdentityDialog
            accountId={account.id}
            accountName={account.name}
          />
        </div>
      </div>

      {/* Setup checklist */}
      <div>
        <p className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">
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
                  : 'bg-surface-hover text-muted hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {completed[key] ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              ) : (
                <span className="inline-block h-3 w-3 rounded-full border border-border" />
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
