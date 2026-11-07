'use client'

import { cn } from '@/lib/cn'
import {
  LINKEDIN_SETTINGS_PATH,
  SECURITY_SETTINGS_PATH,
  THEME_SETTINGS_PATH
} from '@/lib/settings-path'
import { Paintbrush, Send, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: SECURITY_SETTINGS_PATH, label: 'Security', icon: ShieldCheck },
  { href: LINKEDIN_SETTINGS_PATH, label: 'LinkedIn', icon: Send },
  { href: THEME_SETTINGS_PATH, label: 'Theme', icon: Paintbrush }
]

export function SettingsTabs() {
  const pathname = usePathname()

  return (
    <nav aria-label="Settings" className="flex gap-1">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
              active
                ? 'bg-brand/20 text-brand-strong'
                : 'text-muted hover:bg-surface-hover hover:text-foreground'
            )}
          >
            <Icon aria-hidden className="h-3.5 w-3.5" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
