import { PageHeader } from '@/components/page-header'
import { getCapabilities } from '@/lib/capabilities'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { env } from '~/env'

/** Where the app's database is, without the username or password. */
function databaseLocation(): string {
  try {
    const url = new URL(env.DATABASE_URL)
    return `${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`
  } catch {
    return 'DATABASE_URL could not be read'
  }
}

export default function SettingsPage() {
  const capabilities = getCapabilities()

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          <>
            Configure your API keys in{' '}
            <code className="font-mono text-xs bg-surface-hover px-1.5 py-0.5 rounded">.env</code>{' '}
            at the repo root.
          </>
        }
      />
      <div className="p-4 sm:p-6">
        <div className="mx-auto">
          {/* API Keys / Capabilities */}
          <div className="rounded-xl border border-border bg-surface overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">API Keys & Capabilities</h2>
            </div>
            <div className="divide-y divide-border">
              {capabilities.map((cap) => (
                <div key={cap.name} className="flex items-start gap-4 px-5 py-4">
                  {cap.status === 'live' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{cap.name}</p>
                    <p className="text-xs text-muted mt-0.5">{cap.description}</p>
                    {cap.status === 'missing' && (
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                        Add <code className="font-mono bg-surface-hover px-1 py-0.5 rounded text-[11px]">{cap.missingKey}=&quot;...&quot;</code> to <code className="font-mono bg-surface-hover px-1 py-0.5 rounded text-[11px]">.env</code>
                      </p>
                    )}
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
                    cap.status === 'live'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                      : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
                  }`}>
                    {cap.status === 'live' ? 'Active' : 'Not set'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Database */}
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Database</h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-foreground font-medium mb-1">PostgreSQL</p>
              <code className="text-xs font-mono text-muted bg-surface-hover px-2 py-1 rounded block w-full break-all">
                {databaseLocation()}
              </code>
              <p className="text-xs text-muted mt-2">
                Set by <code className="font-mono text-[11px] bg-surface-hover px-1.5 py-0.5 rounded">DATABASE_URL</code>. Run{' '}
                <code className="font-mono text-[11px] bg-surface-hover px-1.5 py-0.5 rounded">npm run db:migrate</code> to apply schema changes.
              </p>
              <p className="text-xs text-muted mt-1">
                Research mode:{' '}
                <code className="font-mono text-[11px] bg-surface-hover px-1.5 py-0.5 rounded">{env.RESEARCH_MODE}</code>
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
