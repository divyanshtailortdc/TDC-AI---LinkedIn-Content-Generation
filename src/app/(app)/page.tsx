import { DeleteIdentityDialog } from '@/components/delete-identity-dialog'
import { PageHeader } from '@/components/page-header'
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

  const hasAnyAccounts = accounts.length > 0

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Dashboard"
        description="Your LinkedIn content generation workspace"
        actions={
          hasAnyAccounts ? (
            <Link
              href="/accounts/new"
              className="bg-accent text-background hover:bg-accent-hover flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add identity
            </Link>
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="mx-auto max-w-7xl space-y-8">
          {/* Capability status panel — always visible */}
          <div className="border-border bg-surface mb-8 overflow-hidden rounded-xl border">
            <div className="border-border border-b px-5 py-4">
              <h2 className="text-foreground text-sm font-semibold">
                Capabilities
              </h2>
              <p className="text-muted mt-0.5 text-xs">
                Based on the keys present in{' '}
                <code className="bg-surface-hover rounded px-1.5 py-0.5 font-mono text-[11px]">
                  .env.local
                </code>
              </p>
            </div>
            <div className="divide-border divide-y">
              {capabilities.map(cap => (
                <div
                  key={cap.name}
                  className="flex items-center gap-4 px-5 py-4"
                >
                  {cap.status === 'live' ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-sm font-medium">
                      {cap.name}
                    </p>
                    <p className="text-muted text-xs">{cap.description}</p>
                  </div>
                  {cap.status === 'live' ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-950/40">
                      Active
                    </span>
                  ) : (
                    <span className="bg-surface-hover text-muted rounded px-2 py-0.5 font-mono text-xs">
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
              accounts={accounts}
              voiceAccountIds={voiceAccountIds}
              knowledgeAccountIds={knowledgeAccountIds}
              goalAccountIds={goalAccountIds}
              prefAccountIds={prefAccountIds}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="border-border bg-surface flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-20">
      <div className="bg-accent/10 mb-5 flex h-14 w-14 items-center justify-center rounded-2xl">
        <Users className="text-accent h-7 w-7" />
      </div>
      <h2 className="text-foreground mb-2 text-lg font-semibold">
        Add your first LinkedIn identity
      </h2>
      <p className="text-muted mb-8 max-w-sm text-center text-sm leading-relaxed">
        An identity is a persona you want to generate content for — yourself,
        your company, or a product. Each one gets its own voice, knowledge base,
        and goals.
      </p>
      <Link
        href="/accounts/new"
        className="bg-accent text-background hover:bg-accent-hover flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
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
  // Active first, so deactivated ones settle at the bottom without being hidden.
  const ordered = [...accounts].sort(
    (a, b) => Number(b.isActive !== false) - Number(a.isActive !== false)
  )

  return (
    <div>
      <h2 className="text-foreground mb-4 text-sm font-semibold">
        Identities ({accounts.length})
      </h2>
      <div className="space-y-4">
        {ordered.map(account => (
          <AccountCard
            key={account.id}
            account={account}
            isActive={account.isActive !== false}
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

  const getStepColor = (key: string, isCompleted: boolean) => {
    if (!isCompleted) return 'bg-surface-hover text-muted hover:text-foreground'
    switch (key) {
      case 'voice':
        return 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400'
      case 'knowledge':
        return 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400'
      case 'goals':
        return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
      case 'preferences':
        return 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400'
      default:
        return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
    }
  }

  const getStepIconColor = (key: string, isCompleted: boolean) => {
    if (!isCompleted) return ''
    switch (key) {
      case 'voice': return 'text-indigo-500'
      case 'knowledge': return 'text-blue-500'
      case 'goals': return 'text-amber-500'
      case 'preferences': return 'text-rose-500'
      default: return 'text-emerald-500'
    }
  }

  return (
    <div
      className={`rounded-2xl border p-6 shadow-xs transition-all hover:shadow-sm ${
        isActive
          ? 'border-border bg-surface hover:border-accent/40'
          : 'border-border/70 border-dashed bg-surface-hover/40 hover:border-amber-500/40'
      }`}
    >
      {/* Account header */}
      <div className="mb-5 flex items-start gap-4">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            isActive ? 'bg-accent text-background' : 'bg-surface-hover text-muted'
          }`}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isActive ? (
              <Link
                href={`/accounts/${account.id}`}
                className="text-foreground hover:text-accent truncate font-semibold transition-colors"
              >
                {account.name}
              </Link>
            ) : (
              <span className="text-foreground truncate font-semibold">
                {account.name}
              </span>
            )}
            {isActive ? (
              <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                Active
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Deactivated
              </span>
            )}
            <span className="bg-surface-hover text-muted shrink-0 rounded-full px-2 py-0.5 text-xs capitalize">
              {account.accountType}
            </span>
          </div>
          <p className="text-muted mt-0.5 truncate text-sm">
            {account.headline}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isActive ? (
            <Link
              href={`/accounts/${account.id}`}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/10"
            >
              Edit
            </Link>
          ) : (
            <span
              aria-disabled="true"
              title="Activate this identity to edit it"
              className="text-muted flex cursor-not-allowed items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold opacity-50 select-none"
            >
              Edit
            </span>
          )}
          <span className="bg-border h-3 w-px" />
          {isActive ? (
            <DeleteIdentityDialog
              accountId={account.id}
              accountName={account.name}
            />
          ) : (
            <ReactivateIdentityButton
              accountId={account.id}
              accountName={account.name}
              label="Activate"
              variant="solid"
            />
          )}
        </div>
      </div>

      {/* Setup checklist */}
      <div>
        <p className="text-muted mb-3 text-xs font-medium tracking-wide uppercase">
          Setup checklist
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {setupSteps.map(({ key, label, icon: Icon }) => {
            const stepClasses = `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive
                ? getStepColor(key, !!completed[key])
                : 'bg-surface-hover text-muted cursor-not-allowed opacity-60 select-none'
            }`
            const stepContent = (
              <>
                <Icon className="h-3.5 w-3.5" />
                {label}
                {completed[key] ? (
                  <CheckCircle2
                    className={`h-3 w-3 ${isActive ? getStepIconColor(key, !!completed[key]) : ''}`}
                  />
                ) : (
                  <span className="border-border inline-block h-3 w-3 rounded-full border bg-background/50" />
                )}
              </>
            )

            return isActive ? (
              <Link
                key={key}
                href={`/accounts/${account.id}/${key}`}
                className={stepClasses}
              >
                {stepContent}
              </Link>
            ) : (
              <span key={key} aria-disabled="true" className={stepClasses}>
                {stepContent}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
