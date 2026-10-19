import { IdentityStatusToggle } from '@/components/identity-status-toggle'
import { PageHeader } from '@/components/page-header'
import { UsageSummaryCards } from '@/components/usage-summary-cards'
import { db } from '@/db'
import {
  accountsTable,
  goalsTable,
  knowledgeDocumentsTable,
  preferencesTable,
  voiceConfigsTable
} from '@/db/schema'
import { getActiveAccount } from '@/lib/active-account'
import { getAccountUsageSummary } from '@/lib/run-spend'
import { getCapabilities, type Capability } from '@/lib/capabilities'
import { eq } from 'drizzle-orm'
import {
  AlertCircle,
  BookOpen,
  Check,
  Mic,
  Plus,
  SlidersHorizontal,
  Target,
  Users
} from 'lucide-react'
import Link from 'next/link'
import { initialsOf } from '@/lib/initials'
import { INACTIVE_ACCOUNT_MESSAGE } from '@/lib/inactive-account'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  // The selected identity, deactivated or not: deactivating it here leaves it
  // on this card, showing Activate, rather than switching to another identity.
  const activeAccount = await getActiveAccount()
  const capabilities = getCapabilities()

  if (!activeAccount) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        <PageHeader title="Dashboard" description="Your LinkedIn content generation workspace" />
        <div className="flex-1 overflow-y-auto bg-background p-4 sm:p-6">
          <div className="mx-auto max-w-5xl space-y-6">
            <CapabilityPanel capabilities={capabilities} />
            <EmptyState />
          </div>
        </div>
      </div>
    )
  }

  const [account, voiceConfigs, knowledgeDocs, goals, prefs, usage] = await Promise.all([
    db.query.accountsTable.findFirst({ where: eq(accountsTable.id, activeAccount.id) }),
    db
      .select({ accountId: voiceConfigsTable.accountId })
      .from(voiceConfigsTable)
      .where(eq(voiceConfigsTable.accountId, activeAccount.id)),
    db
      .select({ accountId: knowledgeDocumentsTable.accountId })
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.accountId, activeAccount.id)),
    db
      .select({ accountId: goalsTable.accountId })
      .from(goalsTable)
      .where(eq(goalsTable.accountId, activeAccount.id)),
    db
      .select({ accountId: preferencesTable.accountId })
      .from(preferencesTable)
      .where(eq(preferencesTable.accountId, activeAccount.id)),
    getAccountUsageSummary(activeAccount.id)
  ])

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Dashboard"
        description="Your LinkedIn content generation workspace"
        actions={
          <Link
            href="/accounts/new"
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-hover"
          >
            <Plus className="h-3.5 w-3.5" />
            Add identity
          </Link>
        }
      />

      <div className="flex-1 overflow-y-auto bg-background p-4 sm:p-6">
        <div className="mx-auto space-y-8">
          <UsageSummaryCards {...usage} />

          {account && (
            <section>
              <h2 className="mb-4 text-sm font-semibold tracking-tight text-foreground">
                Current identity
              </h2>
              <AccountCard
                key={account.id}
                account={account}
                isActive={account.isActive !== false}
                hasVoice={voiceConfigs.length > 0}
                hasKnowledge={knowledgeDocs.length > 0}
                hasGoals={goals.length > 0}
                hasPreferences={prefs.length > 0}
              />
            </section>
          )}

          <CapabilityPanel capabilities={capabilities} />
        </div>
      </div>
    </div>
  )
}

function CapabilityPanel({ capabilities }: { capabilities: Capability[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Capabilities</h2>
        <p className="mt-0.5 text-xs text-muted">
          Based on the keys present in{' '}
          <code className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[11px]">
            .env
          </code>
        </p>
      </div>
      <div className="divide-y divide-border">
        {capabilities.map((cap) => (
          <div key={cap.name} className="flex items-center gap-4 px-5 py-3.5">
            {cap.status === 'live' ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-3 w-3" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{cap.name}</p>
              <p className="text-xs text-muted">{cap.description}</p>
            </div>
            {cap.status === 'live' ? (
              <span className="shrink-0 text-xs font-medium text-muted">Active</span>
            ) : (
              <span className="shrink-0 rounded bg-surface-hover px-2 py-0.5 font-mono text-xs text-muted">
                {cap.missingKey} not set
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-surface py-20">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-hover">
        <Users className="h-7 w-7 text-muted" />
      </div>
      <h2 className="mb-2 text-lg font-semibold tracking-tight text-foreground">
        Add your first LinkedIn identity
      </h2>
      <p className="mb-8 max-w-sm text-center text-sm leading-relaxed text-muted">
        An identity is a persona you want to generate content for — yourself, your company, or a
        product. Each one gets its own voice, knowledge base, and goals.
      </p>
      <Link
        href="/accounts/new"
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-medium text-background transition-colors hover:bg-accent-hover"
      >
        <Plus className="h-3.5 w-3.5" />
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

function AccountCard({
  account,
  isActive,
  hasVoice,
  hasKnowledge,
  hasGoals,
  hasPreferences
}: {
  account: Account
  isActive: boolean
  hasVoice: boolean
  hasKnowledge: boolean
  hasGoals: boolean
  hasPreferences: boolean
}) {
  const initials = initialsOf(account.name)

  const completed: Record<string, boolean> = {
    voice: hasVoice,
    knowledge: hasKnowledge,
    goals: hasGoals,
    preferences: hasPreferences
  }

  const completedCount = Object.values(completed).filter(Boolean).length

  return (
    <div
      className={`rounded-2xl border p-6 shadow-xs ${
        isActive ? 'border-border bg-surface' : 'border-dashed border-border/70 bg-surface-hover/40'
      }`}
    >
      <div className="mb-6 flex items-start gap-4">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            isActive ? 'bg-accent text-background' : 'bg-surface-hover text-muted'
          }`}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/accounts/${account.id}`}
              className="truncate font-semibold tracking-tight text-foreground transition-colors hover:text-muted"
            >
              {account.name}
            </Link>
            <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] capitalize text-muted">
              {account.accountType}
            </span>
            {isActive ? (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                Active
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Deactivated
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">{account.headline}</p>
          {!isActive && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
              {INACTIVE_ACCOUNT_MESSAGE}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/accounts/${account.id}`}
            className="inline-flex h-7 cursor-pointer items-center rounded-lg px-2.5 text-xs font-semibold text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            Edit
          </Link>
          <span className="h-3 w-px bg-border" />
          <IdentityStatusToggle
            key={account.id}
            accountId={account.id}
            accountName={account.name}
            isActive={isActive}
          />
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <p className="text-[10px] font-semibold tracking-wider text-muted uppercase">
            Setup checklist
          </p>
          <p className="text-[11px] text-muted tabular-nums">
            {completedCount} of {setupSteps.length}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {setupSteps.map(({ key, label, icon: Icon }) => {
            const done = !!completed[key]
            return (
              <Link
                key={key}
                href={`/accounts/${account.id}/${key}`}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors ${
                  done
                    ? 'border-border bg-surface-hover/50 text-foreground hover:border-foreground/15'
                    : 'border-dashed border-border text-muted hover:border-foreground/15 hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate">{label}</span>
                {done ? (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                ) : (
                  <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-border" />
                )}
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
