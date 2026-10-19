'use client'

import { useAddPasskey } from '@/components/add-passkey-button'
import { Button } from '@/components/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { FormAlert } from '@/components/form-alert'
import { showToast } from '@/components/toast-notification'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { cn } from '@/lib/cn'
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import { type ComponentProps, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

type Passkey = NonNullable<
  ReturnType<typeof authClient.useListPasskeys>['data']
>[number]

type Refetch = () => Promise<unknown>

const NAME_MAX_LENGTH = 50

const addedOn = (passkey: Passkey) =>
  new Date(passkey.createdAt).toLocaleDateString(undefined, {
    dateStyle: 'medium'
  })

/**
 * Asks the browser's password manager to drop a deleted passkey too, so it
 * stops offering one the server no longer knows (WebAuthn Signal API, in
 * Chrome so far). Where it is missing this does nothing, and the passkey stays
 * listed in the password manager until the user removes it there.
 */
function forgetOnDevice(credentialId: string) {
  const api = window.PublicKeyCredential as
    | {
        signalUnknownCredential?: (options: {
          rpId: string
          credentialId: string
        }) => Promise<void>
      }
    | undefined
  api
    ?.signalUnknownCredential?.({ rpId: location.hostname, credentialId })
    .catch(() => {})
}

function IconButton({
  danger = false,
  className,
  ...props
}: ComponentProps<'button'> & { danger?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'text-muted focus-visible:ring-foreground/30 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none',
        danger
          ? 'hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400'
          : 'hover:bg-foreground/10 hover:text-foreground',
        className
      )}
      {...props}
    />
  )
}

/** One passkey: its name and when it was added, renamed in place. */
function PasskeyRow({
  passkey,
  refetch
}: {
  passkey: Passkey
  refetch: Refetch
}) {
  const name = passkey.name || 'Unnamed passkey'
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const renameRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)

  const startRename = () => {
    setDraft(passkey.name ?? '')
    setRenaming(true)
  }
  const stopRename = () => {
    // Rendered first, so the Rename button is back to take focus.
    flushSync(() => setRenaming(false))
    renameRef.current?.focus()
  }

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault()
    const next = draft.trim()
    if (!next) return
    if (next === passkey.name) return stopRename()
    setSaving(true)
    const { error } = await authClient.passkey.updatePasskey({
      id: passkey.id,
      name: next
    })
    // Reloaded before the form closes, so the old name never flashes back.
    if (!error) await refetch()
    setSaving(false)
    if (error) {
      showToast({
        type: 'error',
        title: 'Passkey not renamed',
        message: authErrorMessage(
          error,
          'The passkey could not be renamed. Please try again.'
        )
      })
      return
    }
    stopRename()
    showToast({ type: 'success', title: 'Passkey renamed' })
  }

  const cancelDelete = () => {
    setConfirmingDelete(false)
    deleteRef.current?.focus()
  }

  const confirmDelete = async () => {
    setDeleting(true)
    const { error } = await authClient.passkey.deletePasskey({
      id: passkey.id
    })
    if (error) {
      setDeleting(false)
      setConfirmingDelete(false)
      showToast({
        type: 'error',
        title: 'Passkey not deleted',
        message: authErrorMessage(
          error,
          'The passkey could not be deleted. Please try again.'
        )
      })
      return
    }
    forgetOnDevice(passkey.credentialID)
    showToast({
      type: 'success',
      title: 'Passkey deleted',
      message: `${name} can no longer be used to sign in.`
    })
    // The row, and this dialog with it, goes once the list has reloaded.
    await refetch()
  }

  return (
    <li className="flex items-center gap-3.5 px-4 py-3.5">
      <span
        aria-hidden
        className="bg-accent/10 text-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
      >
        <KeyRound className="h-4.5 w-4.5" />
      </span>

      {renaming ? (
        <form
          onSubmit={saveName}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
        >
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape' && !saving) stopRename()
            }}
            maxLength={NAME_MAX_LENGTH}
            disabled={saving}
            aria-label="Passkey name"
            placeholder="e.g. Work laptop"
            className="border-border bg-surface-hover text-foreground focus-visible:ring-foreground/30 h-8 min-w-0 flex-1 basis-40 rounded-lg border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              loading={saving}
              disabled={!draft.trim()}
            >
              Save
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={saving}
              onClick={stopRename}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="text-foreground truncate text-sm font-medium">
              {name}
            </p>
            <p className="text-muted mt-0.5 truncate text-xs">
              Added {addedOn(passkey)} ·{' '}
              {passkey.backedUp ? 'Synced across devices' : 'One device only'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              ref={renameRef}
              onClick={startRename}
              title="Rename"
              aria-label={`Rename ${name}`}
            >
              <Pencil aria-hidden className="h-4 w-4" />
            </IconButton>
            <IconButton
              ref={deleteRef}
              danger
              onClick={() => setConfirmingDelete(true)}
              title="Delete"
              aria-label={`Delete ${name}`}
              aria-haspopup="dialog"
            >
              <Trash2 aria-hidden className="h-4 w-4" />
            </IconButton>
          </div>
        </>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this passkey?"
          description={
            <>
              You won&apos;t be able to sign in with{' '}
              <span className="text-foreground font-medium">{name}</span>{' '}
              anymore. Google and LinkedIn sign-in still work.
            </>
          }
          confirmLabel="Yes, delete"
          pendingLabel="Deleting…"
          pending={deleting}
          onCancel={cancelDelete}
          onConfirm={confirmDelete}
        />
      )}
    </li>
  )
}

/**
 * Settings → Security → Passkeys: the signed-in user's passkeys, with adding,
 * renaming and deleting (after a confirmation). Better Auth checks on the
 * server that each passkey belongs to the caller.
 */
export function PasskeysSection() {
  const {
    data: passkeys,
    error,
    isPending,
    refetch
  } = authClient.useListPasskeys()
  const { pending: adding, hasPasskey, addPasskey } = useAddPasskey()

  return (
    <section
      aria-labelledby="passkeys-title"
      className="border-border bg-surface rounded-2xl border p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-60">
          <h2
            id="passkeys-title"
            className="text-foreground flex items-center gap-2.5 text-base font-semibold"
          >
            <span className="bg-accent/10 rounded-lg p-1.5">
              <KeyRound aria-hidden className="text-accent h-4 w-4" />
            </span>
            Passkeys
          </h2>
          <p className="text-muted mt-1 text-xs leading-relaxed">
            Sign in with your fingerprint, face or screen lock instead of Google
            or LinkedIn.
            {hasPasskey &&
              ' You can have one passkey; delete it to add a different one.'}
          </p>
        </div>
        <Button
          size="sm"
          loading={adding}
          disabled={hasPasskey}
          onClick={addPasskey}
        >
          {!adding && <Plus aria-hidden className="h-4 w-4" />}
          Add passkey
        </Button>
      </div>

      <div className="mt-5">
        {isPending ? (
          <div
            aria-busy
            aria-label="Loading passkeys"
            className="border-border divide-border divide-y rounded-xl border"
          >
            {[0, 1].map(i => (
              <div key={i} className="flex items-center gap-3.5 px-4 py-3.5">
                <div className="bg-surface-hover h-10 w-10 animate-pulse rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="bg-surface-hover h-3.5 w-40 animate-pulse rounded" />
                  <div className="bg-surface-hover h-3 w-56 animate-pulse rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : error && !passkeys ? (
          <FormAlert>
            Your passkeys could not be loaded.{' '}
            <button
              type="button"
              onClick={() => refetch()}
              className="cursor-pointer font-medium underline underline-offset-2"
            >
              Try again
            </button>
          </FormAlert>
        ) : !passkeys?.length ? (
          <div className="border-border rounded-xl border-2 border-dashed px-6 py-8 text-center">
            <p className="text-foreground text-sm font-medium">
              No passkeys yet
            </p>
            <p className="text-muted mt-1 text-xs">
              Add one to sign in on this device without Google or LinkedIn.
            </p>
          </div>
        ) : (
          <ul className="border-border divide-border divide-y rounded-xl border">
            {passkeys.map(passkey => (
              <PasskeyRow
                key={passkey.id}
                passkey={passkey}
                refetch={refetch}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
