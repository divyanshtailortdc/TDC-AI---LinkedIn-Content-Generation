'use client'

import { deleteIdentity, switchIdentity } from '@/app/(app)/identity/actions'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { initialsOf } from '@/components/identity-switcher'
import { PageHeader } from '@/components/page-header'
import { Pagination } from '@/components/pagination'
import { markDataChanged } from '@/components/refresh-on-back'
import { showToast } from '@/components/toast-notification'
import { EmptyState } from '@/components/ui/empty-state'
import { TimeAgo } from '@/components/ui/time-ago'
import type { IdentityOverview } from '@/lib/identity-manage'
import { IDENTITY_PATH, NEW_IDENTITY_PATH } from '@/lib/identity-path'
import { PAGE_SIZE, paginate } from '@/lib/pagination'
import {
  ArrowRightLeft,
  Check,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UsersRound
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

const BUTTON =
  'border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60'

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Every identity the user owns: which one the app is working on, what each
 * holds, and switching to, editing or deleting one. Edit opens the identity's
 * setup, which works on the active identity, so another one is switched to
 * first.
 */
export function IdentitiesClient({
  identities,
  activeId
}: {
  identities: IdentityOverview[]
  activeId: string | null
}) {
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [deleting, setDeleting] = useState<IdentityOverview | null>(null)
  const { rows, pageInfo } = paginate(identities, page, PAGE_SIZE)

  /** Makes `identity` the active one, then opens `next` (else stays here). */
  const switchTo = (identity: IdentityOverview, next?: string) => {
    setBusy(identity.id)
    startTransition(async () => {
      const res = await switchIdentity(identity.id)
      if (!res.success) {
        setBusy(null)
        showToast({
          type: 'error',
          title: 'Could not switch',
          message: res.error
        })
        return
      }
      markDataChanged()
      if (next) {
        router.push(next)
      } else {
        showToast({ type: 'success', title: `Switched to ${identity.name}` })
        router.refresh()
      }
      setBusy(null)
    })
  }

  const newIdentity = (
    <Link
      href={identities.length > 0 ? NEW_IDENTITY_PATH : IDENTITY_PATH}
      className="bg-accent hover:bg-accent-hover text-background inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium shadow-sm transition-colors"
    >
      <Plus aria-hidden className="h-3.5 w-3.5" />
      New<span className="hidden sm:inline"> identity</span>
    </Link>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Identities"
        badge={identities.length > 0 ? String(identities.length) : undefined}
        description="Every person and brand you write for. Switch, edit or delete them here."
        actions={newIdentity}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {identities.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="No identities yet"
            description="An identity is a person or brand the Content Engine writes for, with its own profile, voice, goals and posts."
            action={
              <Link href={IDENTITY_PATH} className={BUTTON}>
                <Plus aria-hidden className="h-3.5 w-3.5" />
                Set up your identity
              </Link>
            }
          />
        ) : (
          <>
            <ul className="space-y-3">
              {rows.map(identity => (
                <IdentityRow
                  key={identity.id}
                  identity={identity}
                  active={identity.id === activeId}
                  busy={busy === identity.id}
                  disabled={pending}
                  onSwitch={() => switchTo(identity)}
                  onEdit={() => switchTo(identity, IDENTITY_PATH)}
                  onDelete={() => setDeleting(identity)}
                />
              ))}
            </ul>
            <div className="mt-4">
              <Pagination
                {...pageInfo}
                noun="identities"
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </div>

      {deleting && (
        <DeleteIdentityDialog
          identity={deleting}
          active={deleting.id === activeId}
          // The oldest one left becomes active, as getIdentity picks it.
          nextActive={identities.find(i => i.id !== deleting.id) ?? null}
          onClose={() => setDeleting(null)}
          onDeleted={name => {
            setDeleting(null)
            showToast({ type: 'success', title: `Deleted ${name}` })
            markDataChanged()
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function IdentityRow({
  identity,
  active,
  busy,
  disabled,
  onSwitch,
  onEdit,
  onDelete
}: {
  identity: IdentityOverview
  active: boolean
  /** Switching to it is under way. */
  busy: boolean
  /** Another switch is under way. */
  disabled: boolean
  onSwitch: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const stats = [
    { label: 'Posts', value: identity.posts },
    { label: 'Ideas', value: identity.ideas },
    { label: 'Goals', value: identity.goals }
  ]
  return (
    <li
      className={`bg-surface flex flex-col gap-4 rounded-xl border p-4 sm:p-5 lg:flex-row lg:items-center lg:gap-6 ${active ? 'border-brand/40' : 'border-border'}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <span
          aria-hidden
          className="bg-accent/15 text-accent flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold"
        >
          {initialsOf(identity.name)}
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-foreground truncate text-[15px] font-semibold">
              {identity.name}
            </h2>
            {active && (
              <span className="bg-brand/15 text-brand-strong inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
                <Check aria-hidden className="h-3 w-3" />
                Active
              </span>
            )}
          </div>
          <p className="text-muted mt-0.5 truncate text-xs">
            {identity.accountType === 'company' ? 'Brand' : 'Person'} · @
            {identity.handle}
            {' · '}
            <TimeAgo value={identity.createdAt} prefix="Created" />
          </p>
        </div>
      </div>

      <dl className="flex gap-6">
        {stats.map(stat => (
          <div key={stat.label} className="min-w-12">
            <dt className="text-muted text-[11px] font-medium">{stat.label}</dt>
            <dd className="text-foreground text-sm font-semibold tabular-nums">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* As wide on every row, so the counts line up down the list. */}
      <div className="flex flex-wrap items-center gap-2 lg:w-58 lg:justify-end">
        {!active && (
          <button
            type="button"
            onClick={onSwitch}
            disabled={disabled}
            className={BUTTON}
          >
            {busy ? (
              <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowRightLeft aria-hidden className="h-3.5 w-3.5" />
            )}
            Switch to
          </button>
        )}
        {active ? (
          <Link href={IDENTITY_PATH} className={BUTTON}>
            <Pencil aria-hidden className="h-3.5 w-3.5" />
            Edit
          </Link>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            disabled={disabled}
            title="Switches to this identity and opens its setup"
            className={BUTTON}
          >
            <Pencil aria-hidden className="h-3.5 w-3.5" />
            Edit
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          aria-label={`Delete ${identity.name}`}
          title="Delete identity"
          className="border-border bg-surface text-muted inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:text-rose-400"
        >
          <Trash2 aria-hidden className="h-4 w-4 shrink-0" />
        </button>
      </div>
    </li>
  )
}

/**
 * Deleting an identity for good: what goes with it, then its name typed to
 * confirm, since nothing brings it back. A refusal (a run still working, a
 * post being sent) shows here, and the dialog stays open.
 */
function DeleteIdentityDialog({
  identity,
  active,
  nextActive,
  onClose,
  onDeleted
}: {
  identity: IdentityOverview
  active: boolean
  nextActive: IdentityOverview | null
  onClose: () => void
  onDeleted: (name: string) => void
}) {
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const matches = typed.trim() === identity.name.trim()

  // After the dialog's own focus on Cancel, so typing can start at once.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const confirm = async () => {
    if (!matches || pending) return
    setPending(true)
    setError(null)
    const res = await deleteIdentity(identity.id)
    setPending(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    onDeleted(res.name)
  }

  const goes = [
    identity.posts > 0 && plural(identity.posts, 'post'),
    identity.ideas > 0 && plural(identity.ideas, 'idea'),
    identity.goals > 0 && plural(identity.goals, 'goal'),
    identity.knowledge > 0 && plural(identity.knowledge, 'knowledge document'),
    identity.runs > 0 && plural(identity.runs, 'run'),
    identity.connections > 0 &&
      plural(identity.connections, 'connected account')
  ].filter((item): item is string => Boolean(item))

  return (
    <ConfirmDialog
      title={`Delete ${identity.name}?`}
      description="This deletes the identity and everything in it: its profile, voice, knowledge, goals, ideas, runs, posts, schedule and brand theme. It can't be undone."
      confirmLabel="Delete identity"
      pendingLabel="Deleting…"
      pending={pending}
      confirmDisabled={!matches}
      onCancel={onClose}
      onConfirm={confirm}
    >
      <div className="mt-3 space-y-2 text-sm">
        {goes.length > 0 && (
          <ul className="text-foreground list-disc space-y-0.5 pl-5">
            {goes.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        {identity.scheduled > 0 && (
          <p className="text-muted">
            {identity.scheduled === 1
              ? 'Its scheduled post will not go out.'
              : `Its ${identity.scheduled} scheduled posts will not go out.`}
          </p>
        )}
        {identity.published > 0 && (
          <p className="text-muted">
            Posts already published stay on their platforms.
          </p>
        )}
        {active && (
          <p className="text-muted">
            {nextActive
              ? `You're working on it now. ${nextActive.name} becomes the active identity.`
              : "It's your only identity. You can set up a new one afterwards."}
          </p>
        )}
      </div>

      <form
        className="mt-4"
        onSubmit={e => {
          e.preventDefault()
          void confirm()
        }}
      >
        <label className="text-foreground block text-sm">
          Type <span className="font-semibold">{identity.name}</span> to confirm
          <input
            ref={inputRef}
            value={typed}
            onChange={e => setTyped(e.target.value)}
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
            className="border-border bg-background text-foreground focus:border-foreground/40 focus:ring-foreground/10 mt-1.5 block h-9 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none disabled:opacity-60"
          />
        </label>
      </form>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400"
        >
          {error}
        </p>
      )}
    </ConfirmDialog>
  )
}
