'use client'

import {
  BookOpen,
  Calendar,
  Mic,
  Play,
  SlidersHorizontal,
  Target,
  User
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AiSetupBar } from '@/components/ai-setup/ai-setup-bar'
import { PageHeader } from '@/components/page-header'

interface AccountHeaderProps {
  account: {
    id: string
    name: string
    headline?: string | null
    accountType: string
    avatarUrl?: string | null
    linkedinUrl?: string | null
    websiteUrl?: string | null
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

  const titleNode = (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-[11px] font-bold text-background shadow-xs">
        {initials}
      </div>
      <span className="text-lg font-bold tracking-tight text-foreground truncate">
        {account.name}
      </span>
    </div>
  )

  return (
    <div className="flex flex-col bg-background w-full">
      <PageHeader
        title={titleNode}
        badge={account.accountType}
        description={account.headline || undefined}
      />
      <AiSetupBar account={account} />
      <div className="px-4 sm:px-6 border-b border-border">
        <nav className="flex items-center gap-1 overflow-x-auto w-full h-11">
          {tabs.map(({ label, icon: Icon, href, exact }) => {
            const active = exact
              ? pathname === href
              : pathname === href || pathname.startsWith(href + '/')

            return (
              <Link
                key={label}
                href={href}
                className={`flex items-center gap-2 border-b-2 px-3.5 h-full text-xs font-medium transition-colors shrink-0 ${
                  active
                    ? 'border-accent text-accent font-semibold'
                    : 'border-transparent text-muted hover:border-border hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
