'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Lightbulb,
  FileText,
  Play,
  Settings,
  Sparkles
} from 'lucide-react'

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/accounts', label: 'Accounts', icon: Users },
  { href: '/ideas', label: 'Ideas', icon: Lightbulb },
  { href: '/posts', label: 'Posts', icon: FileText },
  { href: '/runs', label: 'Run Details', icon: Play },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
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

      {/* Footer */}
      <div className="px-4 py-4 border-t border-sidebar-border">
        <p className="text-xs text-muted">Phase 1 · v0.1</p>
      </div>
    </aside>
  )
}
