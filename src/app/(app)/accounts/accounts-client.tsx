'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Users, Mic, BookOpen, Target, SlidersHorizontal, CheckCircle2, ChevronRight, Play } from 'lucide-react'
import { ReactivateIdentityButton } from '@/components/reactivate-identity-button'

type Account = any

const setupSteps = [
  { key: 'voice', label: 'Voice', icon: Mic, href: 'voice' },
  { key: 'knowledge', label: 'Knowledge', icon: BookOpen, href: 'knowledge' },
  { key: 'goals', label: 'Goals', icon: Target, href: 'goals' },
  { key: 'preferences', label: 'Preferences', icon: SlidersHorizontal, href: 'preferences' },
]

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 rounded-xl border-2 border-dashed border-border bg-surface">
      <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-5">
        <Users className="w-7 h-7 text-accent" />
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-2">
        No identities yet
      </h2>
      <p className="text-sm text-muted text-center max-w-sm mb-8 leading-relaxed">
        An identity is a persona you want to generate content for — yourself, your company, or a
        product. Each one gets its own voice, knowledge base, and goals.
      </p>
      <Link
        href="/accounts/new"
        className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-lg bg-accent hover:bg-accent-hover text-background text-[13px] font-medium transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add your first identity
      </Link>
    </div>
  )
}

function AccountCard({
  account,
  isActive,
  hasVoice,
  hasKnowledge,
  hasGoals,
  hasPreferences,
}: {
  account: Account
  isActive: boolean
  hasVoice: boolean
  hasKnowledge: boolean
  hasGoals: boolean
  hasPreferences: boolean
}) {
  const initials = account.name
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const completed: Record<string, boolean> = {
    voice: hasVoice,
    knowledge: hasKnowledge,
    goals: hasGoals,
    preferences: hasPreferences,
  }

  const completedCount = Object.values(completed).filter(Boolean).length
  const allDone = completedCount === setupSteps.length

  const getStepColor = (key: string, isCompleted: boolean) => {
    if (!isCompleted) return 'bg-surface-hover text-muted hover:text-foreground'
    switch (key) {
      case 'voice':
        return 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400'
      case 'knowledge':
        return 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400'
      case 'goals':
        return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
      case 'preferences':
        return 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400'
      default:
        return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
    }
  }

  const getStepIconColor = (key: string, isCompleted: boolean) => {
    if (!isCompleted) return ''
    switch (key) {
      case 'voice': return 'text-indigo-500'
      case 'knowledge': return 'text-blue-500'
      case 'goals': return 'text-amber-500'
      case 'preferences': return 'text-rose-500'
      default: return 'text-emerald-500'
    }
  }

  return (
    <div
      className={`rounded-2xl border overflow-hidden transition-all shadow-xs hover:shadow-sm ${
        isActive
          ? 'border-border bg-surface hover:border-accent/40'
          : 'border-border/70 border-dashed bg-surface-hover/40 hover:border-amber-500/40'
      }`}
    >
      <div className="flex items-start gap-4 p-5 border-b border-border">
        <div
          className={`w-11 h-11 rounded-full font-semibold text-sm flex items-center justify-center shrink-0 ${
            isActive ? 'bg-accent text-background' : 'bg-surface-hover text-muted'
          }`}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground">{account.name}</h3>
            <span className="text-xs capitalize text-muted bg-surface-hover px-2 py-0.5 rounded-full shrink-0">
              {account.accountType}
            </span>
            {isActive ? (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full shrink-0">
                Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Deactivated
              </span>
            )}
            {allDone ? (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Ready
              </span>
            ) : (
              <span className="text-xs text-muted bg-surface-hover px-2 py-0.5 rounded-full shrink-0">
                {completedCount}/{setupSteps.length} setup
              </span>
            )}
          </div>
          {account.headline && (
            <p className="text-sm text-muted truncate mt-0.5">{account.headline}</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!isActive && (
            <ReactivateIdentityButton
              accountId={account.id}
              accountName={account.name}
              label="Activate"
              variant="solid"
            />
          )}
          {isActive && allDone && (
            <Link
              href={`/accounts/${account.id}/runs`}
              className="inline-flex h-7 items-center gap-1.5 text-xs font-semibold px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              <Play className="w-3 h-3 fill-current" />
              Generate
            </Link>
          )}
          {isActive ? (
            <Link
              href={`/accounts/${account.id}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
            >
              Open
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <span
              aria-disabled="true"
              title="Activate this identity to open it"
              className="inline-flex cursor-not-allowed items-center gap-1.5 text-xs font-semibold text-muted opacity-50 select-none"
            >
              Open
              <ChevronRight className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-3.5 flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-muted uppercase tracking-wide mr-1">
          Setup:
        </span>
        {setupSteps.map(({ key, label, icon: Icon, href }) => {
          const stepClasses = `flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
            isActive
              ? getStepColor(key, !!completed[key])
              : 'bg-surface-hover text-muted cursor-not-allowed opacity-60 select-none'
          }`
          const stepContent = (
            <>
              <Icon className="w-3.5 h-3.5" />
              {label}
              {completed[key] ? (
                <CheckCircle2
                  className={`w-3 h-3 ${isActive ? getStepIconColor(key, !!completed[key]) : ''}`}
                />
              ) : (
                <span className="w-3 h-3 rounded-full border border-border bg-background/50 inline-block" />
              )}
            </>
          )

          return isActive ? (
            <Link
              key={key}
              href={`/accounts/${account.id}/${href}`}
              className={stepClasses}
            >
              {stepContent}
            </Link>
          ) : (
            <span key={key} aria-disabled="true" className={stepClasses}>
              {stepContent}
            </span>
          )
        })}
      </div>
    </div>
  )
}

interface AccountsClientProps {
  accounts: any[]
  voiceAccountIds: Set<string>
  knowledgeAccountIds: Set<string>
  goalAccountIds: Set<string>
  prefAccountIds: Set<string>
}

export function AccountsClient({
  accounts,
  voiceAccountIds,
  knowledgeAccountIds,
  goalAccountIds,
  prefAccountIds,
}: AccountsClientProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredAccounts = accounts.filter(
    (a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
           (a.headline && a.headline.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  // Active first, so deactivated ones settle at the bottom without being hidden.
  const orderedAccounts = [...filteredAccounts].sort(
    (a, b) => Number(b.isActive !== false) - Number(a.isActive !== false)
  )
  const hasAnyAccounts = accounts.length > 0

  if (!hasAnyAccounts) {
    return <EmptyState />
  }

  return (
    <div className="space-y-8">
      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
        <input
          type="text"
          placeholder="Search identities..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-surface border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-accent transition-colors"
        />
      </div>

      {/* Identities */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-4">
          Identities ({orderedAccounts.length})
        </p>
        {orderedAccounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted bg-surface">
            {searchQuery ? 'No identities match your search.' : 'No identities yet. Add one to get started.'}
          </div>
        ) : (
          <div className="space-y-4">
            {orderedAccounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                isActive={account.isActive !== false}
                hasVoice={voiceAccountIds.has(account.id)}
                hasKnowledge={knowledgeAccountIds.has(account.id)}
                hasGoals={goalAccountIds.has(account.id)}
                hasPreferences={prefAccountIds.has(account.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
