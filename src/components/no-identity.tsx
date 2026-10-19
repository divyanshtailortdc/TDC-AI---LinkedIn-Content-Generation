import { PageHeader } from '@/components/page-header'
import { ArrowRight, Users } from 'lucide-react'
import Link from 'next/link'

/**
 * Shown on identity-scoped pages (Ideas, Posts, Runs) before the signed-in
 * user has set up their identity.
 */
export function NoIdentity({ title }: { title: string }) {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader title={title} />
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="border-border bg-surface max-w-sm rounded-2xl border-2 border-dashed p-10 text-center">
          <div className="bg-accent/10 mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl">
            <Users className="text-accent h-7 w-7" />
          </div>
          <h2 className="text-foreground mb-2 text-lg font-semibold">
            No identity yet
          </h2>
          <p className="text-muted mb-8 text-sm leading-relaxed">
            Set up your identity to see its content here.
          </p>
          <Link
            href="/identity"
            className="bg-accent text-background hover:bg-accent-hover inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors"
          >
            Set up your identity
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  )
}
