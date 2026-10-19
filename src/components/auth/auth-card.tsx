import { AuthLogo } from '@/components/auth/auth-logo'
import type { ReactNode } from 'react'

/** The card the sign-in page is laid out in. */
export function AuthCard({
  title,
  description,
  children
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="border-border bg-surface w-full max-w-132 rounded-2xl border px-6 py-10 shadow-[0_8px_30px_-12px_rgb(15_40_80/0.12)] sm:px-11 sm:py-11">
      <header className="flex flex-col items-center text-center">
        <AuthLogo className="h-12 w-auto" />
        <p className="border-border text-muted mt-5 inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-[12px] whitespace-nowrap sm:text-[13px]">
          Powered by TDCCommerce
          <span aria-hidden className="text-muted/60">
            •
          </span>
          <span className="text-foreground font-medium">LinkedIn Engine</span>
        </p>
        <h1 className="text-foreground mt-7 text-3xl font-bold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-muted mt-3 max-w-sm text-base leading-relaxed">
            {description}
          </p>
        )}
      </header>
      <div className="mt-8">{children}</div>
    </div>
  )
}
