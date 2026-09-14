'use client'

import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Layers,
  Mic,
  Play,
  SlidersHorizontal,
  Target,
  User
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface AccountHeaderProps {
  account: {
    id: string
    name: string
    headline?: string | null
    accountType: string
    avatarUrl?: string | null
  }
}

export function AccountHeader({ account }: AccountHeaderProps) {
  const pathname = usePathname()

  const initials = account.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const tabs = [
    {
      label: 'Profile',
      icon: User,
      href: `/accounts/${account.id}`,
      exact: true
    },
    {
      label: 'Voice',
      icon: Mic,
      href: `/accounts/${account.id}/voice`,
      exact: false
    },
    {
      label: 'Knowledge',
      icon: BookOpen,
      href: `/accounts/${account.id}/knowledge`,
      exact: false
    },
    {
      label: 'Goals',
      icon: Target,
      href: `/accounts/${account.id}/goals`,
      exact: false
    },
    {
      label: 'Preferences',
      icon: SlidersHorizontal,
      href: `/accounts/${account.id}/preferences`,
      exact: false
    },
    {
      label: 'Schedule',
      icon: Calendar,
      href: `/accounts/${account.id}/schedule`,
      exact: false
    },
    {
      label: 'Runs',
      icon: Play,
      href: `/accounts/${account.id}/runs`,
      exact: false
    }
  ]

  return (
    <div className="mb-8 border-b border-[var(--border)] pb-0">
      {/* Back to dashboard */}
      <Link
        href="/"
        className="mb-5 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Dashboard
      </Link>

      {/* Identity Card */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] text-lg font-bold text-white shadow-xs">
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-[var(--foreground)] truncate">
              {account.name}
            </h1>
            <span className="rounded-full bg-[var(--surface-hover)] px-2.5 py-0.5 text-xs font-medium text-[var(--muted)] capitalize shrink-0">
              {account.accountType}
            </span>
          </div>
          {account.headline && (
            <p className="mt-0.5 text-xs text-[var(--muted)] truncate">
              {account.headline}
            </p>
          )}
        </div>
      </div>

      {/* Tabs Row */}
      <nav className="flex items-center gap-1 overflow-x-auto pb-px">
        {tabs.map(({ label, icon: Icon, href, exact }) => {
          const active = exact
            ? pathname === href
            : pathname === href || pathname.startsWith(href + '/')

          return (
            <Link
              key={label}
              href={href}
              className={`flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-medium transition-colors shrink-0 ${
                active
                  ? 'border-[var(--accent)] text-[var(--accent)] font-semibold'
                  : 'border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--foreground)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
