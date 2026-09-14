import Link from 'next/link'
import {
  Plus,
  CheckCircle2,
  AlertCircle,
  Users,
  Mic,
  BookOpen,
  Target,
  SlidersHorizontal
} from 'lucide-react'
import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { getCapabilities } from '@/lib/capabilities'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const [accounts, capabilities] = await Promise.all([
    db.select().from(accountsTable),
    Promise.resolve(getCapabilities())
  ])

  const hasAccounts = accounts.length > 0

  return (
    <div className="p-8 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Dashboard</h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">
            Your LinkedIn content generation workspace
          </p>
        </div>
        {hasAccounts && (
          <Link
            href="/accounts/new"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add identity
          </Link>
        )}
      </div>

      {/* Capability status panel — always visible */}
      <div className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Capabilities</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Based on the keys present in <code className="font-mono text-[11px] bg-[var(--surface-hover)] px-1.5 py-0.5 rounded">.env.local</code>
          </p>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {capabilities.map((cap) => (
            <div key={cap.name} className="flex items-center gap-4 px-5 py-4">
              {cap.status === 'live' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--foreground)]">{cap.name}</p>
                <p className="text-xs text-[var(--muted)]">{cap.description}</p>
              </div>
              {cap.status === 'live' ? (
                <span className="text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
                  Active
                </span>
              ) : (
                <span className="text-xs text-[var(--muted)] font-mono bg-[var(--surface-hover)] px-2 py-0.5 rounded">
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
        <AccountList accounts={accounts} />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)]">
      <div className="w-14 h-14 rounded-2xl bg-[var(--accent)]/10 flex items-center justify-center mb-5">
        <Users className="w-7 h-7 text-[var(--accent)]" />
      </div>
      <h2 className="text-lg font-semibold text-[var(--foreground)] mb-2">
        Add your first LinkedIn identity
      </h2>
      <p className="text-sm text-[var(--muted)] text-center max-w-sm mb-8 leading-relaxed">
        An identity is a persona you want to generate content for — yourself, your company, or a product. Each one gets its own voice, knowledge base, and goals.
      </p>
      <Link
        href="/accounts/new"
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium transition-colors"
      >
        <Plus className="w-4 h-4" />
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
  { key: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
]

function AccountList({ accounts }: { accounts: Account[] }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-[var(--foreground)] mb-4">
        Identities ({accounts.length})
      </h2>
      <div className="space-y-4">
        {accounts.map((account) => (
          <AccountCard key={account.id} account={account} />
        ))}
      </div>
    </div>
  )
}

function AccountCard({ account }: { account: Account }) {
  const initials = account.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  // TODO: query voice/knowledge/goals/preferences completion in M1
  const completed: Record<string, boolean> = {
    voice: false,
    knowledge: false,
    goals: false,
    preferences: false
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 hover:border-[var(--accent)]/40 transition-colors">
      {/* Account header */}
      <div className="flex items-start gap-4 mb-5">
        <div className="w-10 h-10 rounded-full bg-[var(--accent)] text-white font-semibold text-sm flex items-center justify-center shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[var(--foreground)] truncate">{account.name}</h3>
            <span className="text-xs capitalize text-[var(--muted)] bg-[var(--surface-hover)] px-2 py-0.5 rounded-full shrink-0">
              {account.accountType}
            </span>
          </div>
          <p className="text-sm text-[var(--muted)] truncate mt-0.5">{account.headline}</p>
        </div>
        <Link
          href={`/accounts/${account.id}`}
          className="text-xs text-[var(--accent)] hover:underline shrink-0"
        >
          View →
        </Link>
      </div>

      {/* Setup checklist */}
      <div>
        <p className="text-xs text-[var(--muted)] mb-3 font-medium uppercase tracking-wide">Setup checklist</p>
        <div className="flex items-center gap-3 flex-wrap">
          {setupSteps.map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              href={`/accounts/${account.id}/${key}`}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                completed[key]
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                  : 'bg-[var(--surface-hover)] text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {completed[key] ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              ) : (
                <span className="w-3 h-3 rounded-full border border-[var(--border)] inline-block" />
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
