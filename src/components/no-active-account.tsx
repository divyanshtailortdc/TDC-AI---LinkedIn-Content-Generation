import Link from 'next/link'
import { ArrowRight, Users } from 'lucide-react'
import { PageHeader } from '@/components/page-header'

/**
 * Shown on account-scoped pages (Ideas, Posts, Runs) when there is no identity
 * to show yet. A deactivated identity is still shown, so this means none exist.
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
          <h2 className="mb-2 text-lg font-semibold text-foreground">No identity yet</h2>
          <p className="mb-8 text-sm leading-relaxed text-muted">
            Add an identity to see its content here.
          </p>
          <Link
            href="/accounts/new"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-medium text-background transition-colors hover:bg-accent-hover"
          >
            Add an identity
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  )
}
