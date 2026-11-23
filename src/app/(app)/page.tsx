import { OnboardingChecklist } from '@/components/onboarding/checklist'
import { PageHeader } from '@/components/page-header'
import {
  UsageSummaryCards,
  UsageSummarySkeleton
} from '@/components/usage-summary-cards'
import { accountsTable } from '@/db/schema'
import { getIdentity, IDENTITY_PATH } from '@/lib/identity'
import { getAccountUsageSummary } from '@/lib/run-spend'
import { getCapabilities, type Capability } from '@/lib/capabilities'
import { AlertCircle, Check } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import { initialsOf } from '@/lib/initials'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const account = await getIdentity()
  const capabilities = getCapabilities()

  if (!account) {
    // A new user: the getting-started checklist opens on creating the
    // identity, the first of its steps.
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        <PageHeader title="Dashboard" description="Your content generation workspace" />
        <div className="flex-1 overflow-y-auto bg-background p-4 sm:p-6">
          <div className="mx-auto max-w-6xl space-y-6">
            <OnboardingChecklist />
            <CapabilityPanel capabilities={capabilities} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Dashboard"
        description="Your content generation workspace"
      />

      <div className="flex-1 overflow-y-auto bg-background p-4 sm:p-6">
        <div className="mx-auto space-y-8">
          {/* Until the first post is out; afterwards once, to celebrate. */}
          <OnboardingChecklist />

          <Suspense fallback={<UsageSummarySkeleton />}>
            <AccountUsage accountId={account.id} />
          </Suspense>

          <section>
            <h2 className="mb-4 text-sm font-semibold tracking-tight text-foreground">
              Your identity
            </h2>
            <AccountCard account={account} />
          </section>

          <CapabilityPanel capabilities={capabilities} />
        </div>
      </div>
    </div>
  )
}

/**
 * All-time usage adds up every AI call made for the identity (the usage
 * ledger), so it streams in on its own rather than holding the rest of the
 * dashboard until it is done.
 */
async function AccountUsage({ accountId }: { accountId: string }) {
  return <UsageSummaryCards {...await getAccountUsageSummary(accountId)} />
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

type Account = typeof accountsTable.$inferSelect

/**
 * Who the workspace writes for. What is set up and what is still to do is
 * the getting-started checklist above (src/components/onboarding).
 */
function AccountCard({ account }: { account: Account }) {
  const initials = initialsOf(account.name)

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-background">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={IDENTITY_PATH}
              className="truncate font-semibold tracking-tight text-foreground transition-colors hover:text-muted"
            >
              {account.name}
            </Link>
            <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] capitalize text-muted">
              {account.accountType}
            </span>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">{account.headline}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={IDENTITY_PATH}
            className="inline-flex h-7 cursor-pointer items-center rounded-lg px-2.5 text-xs font-semibold text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            Edit
          </Link>
        </div>
      </div>
    </div>
  )
}
