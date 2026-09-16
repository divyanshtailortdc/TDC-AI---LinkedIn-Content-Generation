import Link from 'next/link'
import { ArrowRight, Users } from 'lucide-react'
import { PageHeader } from '@/components/page-header'

/**
 * Shown on account-scoped pages (Ideas, Posts, Runs) when there is no active
 * identity yet — either no accounts exist, or all of them are deactivated.
 */
export function NoActiveAccount({ title }: { title: string }) {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader title={title} />
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-sm rounded-2xl border-2 border-dashed border-border bg-surface p-10 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10">
            <Users className="h-7 w-7 text-accent" />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-foreground">No active identity</h2>
          <p className="mb-8 text-sm leading-relaxed text-muted">
            Add an identity, or reactivate an existing one, then select it from the switcher to see
            its content here.
          </p>
          <Link
            href="/accounts/new"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-accent-hover"
          >
            Add an identity
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}
