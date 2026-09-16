'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Lightbulb,
  FileText,
  Play,
  Sparkles
} from 'lucide-react'
import { AccountSwitcher, type SwitchableAccount } from '@/components/account-switcher'

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/ideas', label: 'Ideas', icon: Lightbulb },
  { href: '/posts', label: 'Posts', icon: FileText },
  { href: '/runs', label: 'Run Details', icon: Play },
]

export function Sidebar({
  accounts,
  activeAccount
}: {
  accounts: SwitchableAccount[]
  activeAccount: SwitchableAccount | null
}) {
  const pathname = usePathname()

  return (
    <aside className="w-60 shrink-0 flex flex-col h-full bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-sidebar-border">
        <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-background" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight truncate text-foreground">TDC LinkedIn</p>
          <p className="text-xs text-muted leading-tight">Content Engine</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active =
            href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${active
                  ? 'bg-accent text-background shadow-sm'
                  : 'text-muted hover:bg-surface-hover hover:text-foreground'
                }
              `}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Active identity switcher */}
      <div className="px-3 py-3 border-t border-sidebar-border">
        <AccountSwitcher accounts={accounts} activeAccount={activeAccount} />
        <p className="mt-2.5 px-1 text-xs text-muted">Phase 1 · v0.1</p>
      </div>
    </aside>
  )
}
