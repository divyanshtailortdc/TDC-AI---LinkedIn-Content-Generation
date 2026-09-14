import { getCapabilities } from '@/lib/capabilities'
import { CheckCircle2, AlertCircle } from 'lucide-react'

export default function SettingsPage() {
  const capabilities = getCapabilities()

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Settings</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Configure your API keys in <code className="font-mono text-xs bg-[var(--surface-hover)] px-1.5 py-0.5 rounded">.env.local</code> at the repo root.
        </p>
      </div>

      {/* API Keys / Capabilities */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">API Keys & Capabilities</h2>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {capabilities.map((cap) => (
            <div key={cap.name} className="flex items-start gap-4 px-5 py-4">
              {cap.status === 'live' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--foreground)]">{cap.name}</p>
                <p className="text-xs text-[var(--muted)] mt-0.5">{cap.description}</p>
                {cap.status === 'missing' && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Add <code className="font-mono bg-[var(--surface-hover)] px-1 py-0.5 rounded text-[11px]">{cap.missingKey}=&quot;...&quot;</code> to <code className="font-mono bg-[var(--surface-hover)] px-1 py-0.5 rounded text-[11px]">.env.local</code>
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
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Database</h2>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-[var(--foreground)] font-medium mb-1">PostgreSQL (local)</p>
          <code className="text-xs font-mono text-[var(--muted)] bg-[var(--surface-hover)] px-2 py-1 rounded block w-full break-all">
            postgresql://postgres:postgres@localhost:5432/linkedin-agent
          </code>
          <p className="text-xs text-[var(--muted)] mt-2">
            Run <code className="font-mono text-[11px] bg-[var(--surface-hover)] px-1.5 py-0.5 rounded">npm run db:push</code> to apply the schema.
          </p>
        </div>
      </div>
    </div>
  )
}
