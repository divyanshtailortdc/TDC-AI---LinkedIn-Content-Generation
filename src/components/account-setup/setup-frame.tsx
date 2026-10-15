'use client'

import { useSuggestedSections } from '@/components/ai-setup/draft-store'
import { ThemeToggle } from '@/components/theme-toggle'
import type { SetupSection } from '@/lib/ai/skills/profile-setup/schema'
import { Loader2, Pencil } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { SETUP_STEPS } from './steps'

// ---------------------------------------------------------------------------
// Save & Next: the step's form hands its save to the header button
// ---------------------------------------------------------------------------

/** Saves the step; resolves false when it failed and the user should stay. */
type StepSave = () => Promise<boolean> | boolean

const StepSaveContext = createContext<{
  register: (save: StepSave) => () => void
} | null>(null)

/**
 * Lets a form take part in the header's Save & Next. A step can hold several
 * forms (Preferences also holds the schedule); they are saved in the order
 * they appear, and the step only advances if every one succeeds. The latest
 * `save` is always the one called, so it can read current form state.
 */
export function useStepSave(save: StepSave) {
  const ctx = useContext(StepSaveContext)
  const latest = useRef(save)
  useEffect(() => {
    latest.current = save
  })
  useEffect(() => {
    if (!ctx) return
    return ctx.register(() => latest.current())
  }, [ctx])
}

// ---------------------------------------------------------------------------
// Edit / view: a step that already has saved data opens read-only
// ---------------------------------------------------------------------------

type StepView = { dirty: boolean; cancel: () => void }

const StepViewContext = createContext<{
  /** False while a saved step is being viewed. */
  editing: boolean
  setView: (id: string, view: StepView) => void
  removeView: (id: string) => void
} | null>(null)

/**
 * Lets a step's form take part in the header's Edit / Cancel. Returns whether
 * the step is being edited right now.
 *
 * - `dirty`: the form holds changes that are not saved (for example the AI
 *   filled fields), so it must be editable and cannot be hidden behind Edit.
 * - `onCancel`: put the form back to what is saved.
 */
export function useStepView({
  dirty = false,
  onCancel
}: {
  dirty?: boolean
  onCancel?: () => void
} = {}): boolean {
  const ctx = useContext(StepViewContext)
  const id = useId()
  const latest = useRef(onCancel)
  useEffect(() => {
    latest.current = onCancel
  })
  const cancel = useCallback(() => latest.current?.(), [])

  const setView = ctx?.setView
  const removeView = ctx?.removeView
  useEffect(() => {
    setView?.(id, { dirty, cancel })
  }, [setView, id, dirty, cancel])
  useEffect(() => () => removeView?.(id), [removeView, id])

  return ctx ? ctx.editing : true
}

/**
 * Wraps a step's controls. While a saved step is viewed, every input, select
 * and button inside is disabled and drawn as plain read-only text, so nothing
 * on screen invites typing until the person clicks Edit. Anything marked
 * `data-edit-only` (an Add or Remove button) is hidden outright.
 */
export function StepFields({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}) {
  const editing = useContext(StepViewContext)?.editing ?? true
  return (
    <fieldset
      disabled={!editing}
      className={`m-0 min-w-0 border-0 p-0 ${
        editing
          ? ''
          : '[&_:is(input,textarea,select):disabled]:bg-surface-hover/40 [&_:is(input,textarea,select):disabled]:border-border/60 [&_:is(input,textarea,select):disabled]:text-foreground [&_:is(input,textarea,select):disabled]:cursor-default [&_:is(input,textarea,select):disabled]:opacity-100 [&_[data-edit-only]]:hidden [&_button:disabled]:cursor-default [&_button:disabled]:opacity-100'
      } ${className}`}
    >
      {children}
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Step bar
// ---------------------------------------------------------------------------

/**
 * The numbered step bar with connectors. Steps link to their pages when an
 * account exists; on the create page they are shown but not clickable yet.
 */
export function SetupStepper({
  activeIndex,
  accountId,
  draftKey
}: {
  activeIndex: number
  accountId?: string
  /** Which AI draft decides the "suggestions ready" dots. */
  draftKey: string
}) {
  const suggested = useSuggestedSections(draftKey)

  return (
    <nav aria-label="Setup steps">
      <ol className="flex items-start">
        {SETUP_STEPS.map((step, index) => {
          const active = index === activeIndex
          const Icon = step.icon
          const hasSuggestions = suggested.has(step.key as SetupSection)

          const content = (
            <>
              <span
                className={`relative flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-accent text-background shadow-sm'
                    : step.optional
                      ? 'border-border bg-surface text-muted group-hover:text-foreground border border-dashed'
                      : 'border-border bg-surface text-muted group-hover:border-accent/40 group-hover:text-foreground border'
                }`}
              >
                {active ? index + 1 : <Icon className="h-3.5 w-3.5" />}
                {hasSuggestions && (
                  <span
                    title="AI suggestions ready"
                    className="border-surface absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 bg-indigo-500"
                  />
                )}
              </span>
              <span
                className={`flex items-center gap-1 text-xs whitespace-nowrap transition-colors ${
                  active
                    ? 'text-foreground font-semibold'
                    : 'text-muted group-hover:text-foreground hidden font-medium sm:flex'
                }`}
              >
                {step.label}
                {step.optional && (
                  <span className="rounded bg-amber-100 px-1 text-[9px] leading-3.5 font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                    Opt
                  </span>
                )}
              </span>
            </>
          )

          return (
            <Fragment key={step.key}>
              {index > 0 && (
                <li
                  aria-hidden
                  className="bg-border mx-1.5 mt-4 h-px min-w-3 flex-1 sm:mx-2.5"
                />
              )}
              <li className="flex shrink-0 flex-col items-center">
                {accountId ? (
                  <Link
                    href={`/accounts/${accountId}${step.path}`}
                    aria-current={active ? 'step' : undefined}
                    className="group flex flex-col items-center gap-1.5"
                  >
                    {content}
                  </Link>
                ) : (
                  <span
                    aria-current={active ? 'step' : undefined}
                    className="group flex cursor-default flex-col items-center gap-1.5"
                  >
                    {content}
                  </span>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

/**
 * The frame shared by every setup step, filling exactly the screen: a header
 * card (who, the steps, theme, Save & Next), then one main card holding the
 * step's title and content, with the AI assistant beside it on the Profile
 * step. Only the body scrolls.
 */
export function SetupFrame({
  identity,
  nav,
  aside,
  stepIndex,
  nextHref,
  hasSavedData = false,
  title,
  description,
  children
}: {
  identity: ReactNode
  nav: ReactNode
  /** The Profile step's AI assistant, shown on the right. Other steps have none. */
  aside?: ReactNode
  stepIndex: number
  /** Where Save & Next goes after a successful save; none on the last step. */
  nextHref?: string
  /**
   * The step already has saved data, so it opens read-only with Edit in the
   * header. Read once, when the step opens: saving the first goal on a blank
   * step must not hide the form under the person's hands.
   */
  hasSavedData?: boolean
  /** Override the step's own title and description. */
  title?: string
  description?: string
  children: ReactNode
}) {
  const router = useRouter()
  const step = SETUP_STEPS[stepIndex]!
  const isLast = stepIndex === SETUP_STEPS.length - 1

  const saves = useRef(new Set<StepSave>())
  const register = useCallback((save: StepSave) => {
    saves.current.add(save)
    return () => {
      saves.current.delete(save)
    }
  }, [])
  const ctx = useMemo(() => ({ register }), [register])
  const [saving, setSaving] = useState(false)

  const [viewable] = useState(hasSavedData)
  const [edit, setEdit] = useState(false)
  const [views, setViews] = useState<Record<string, StepView>>({})
  const setView = useCallback((id: string, view: StepView) => {
    setViews(prev =>
      prev[id]?.dirty === view.dirty && prev[id]?.cancel === view.cancel
        ? prev
        : { ...prev, [id]: view }
    )
  }, [])
  const removeView = useCallback((id: string) => {
    setViews(prev => {
      const { [id]: _removed, ...rest } = prev
      return rest
    })
  }, [])
  // Unsaved changes keep the step editable; otherwise a saved step is viewed.
  const editing =
    !viewable || edit || Object.values(views).some(view => view.dirty)
  const viewCtx = useMemo(
    () => ({ editing, setView, removeView }),
    [editing, setView, removeView]
  )
  const cancelEditing = () => {
    for (const view of Object.values(views)) view.cancel()
    setEdit(false)
  }

  const saveAndNext = async () => {
    setSaving(true)
    try {
      let ok = true
      // Sets keep insertion order, so forms save top to bottom.
      for (const save of saves.current) {
        if (!(await save())) {
          ok = false
          break
        }
      }
      if (ok) setEdit(false)
      // if (ok && nextHref) router.push(nextHref)
    } finally {
      setSaving(false)
    }
  }

  return (
    <StepSaveContext.Provider value={ctx}>
      <div className="bg-surface-hover/40 flex h-dvh min-h-0 flex-col">
        <div className="shrink-0 px-4 pt-4 sm:px-6">
          {/* Sized by its own width, not the screen's: the app sidebar takes
              part of the screen, so a "wide" screen can still be a narrow header. */}
          <header className="border-border bg-surface @container mx-auto max-w-screen-2xl rounded-2xl border px-4 py-3 shadow-xs sm:px-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex min-w-0 flex-1 items-center gap-3 @4xl:w-44 @4xl:flex-none">
                {identity}
              </div>

              <div className="order-last w-full @4xl:order-0 @4xl:w-auto @4xl:flex-1">
                {nav}
              </div>

              <div className="flex shrink-0 items-center gap-2.5">
                <div className="border-border rounded-xl border">
                  <ThemeToggle />
                </div>
                {!isLast && viewable && !editing && (
                  <button
                    type="button"
                    onClick={() => setEdit(true)}
                    className="bg-accent hover:bg-accent-hover text-background inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-semibold whitespace-nowrap shadow-sm transition-colors sm:h-10"
                  >
                    <Pencil className="h-4 w-4" />
                    Edit
                  </button>
                )}
                {!isLast && (!viewable || editing) && (
                  <>
                    {viewable && (
                      <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={saving}
                        className="border-border text-foreground hover:bg-surface-hover inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-60 sm:h-10"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={saveAndNext}
                      disabled={saving}
                      className="bg-accent hover:bg-accent-hover text-background inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-semibold whitespace-nowrap shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:h-10"
                    >
                      {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </header>
        </div>

        {/* On wide screens both cards fill the remaining height and width on
            every step, and only the main card's content scrolls. Narrower
            screens stack the cards and let the page scroll instead. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6 sm:pb-5 xl:overflow-hidden">
          <div
            className={`mx-auto grid max-w-screen-2xl gap-5 xl:h-full ${
              aside ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : ''
            }`}
          >
            {/* It still comes first when the cards stack, since the assistant
                is the quickest way to fill the form. */}
            {aside && (
              <aside className="order-first min-h-0 xl:order-last xl:h-full xl:overflow-y-auto">
                {aside}
              </aside>
            )}

            <section className="border-border bg-surface flex min-h-0 min-w-0 flex-col rounded-xl border shadow-xs xl:h-full">
              <div className="flex shrink-0 items-start justify-between gap-4 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
                <div className="min-w-0">
                  <h1 className="text-foreground text-lg font-bold tracking-tight">
                    {title ?? step.title}
                  </h1>
                  <p className="text-muted mt-0.5 text-sm">
                    {description ?? step.description}
                  </p>
                </div>
                <span className="border-border bg-surface text-foreground shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium">
                  Step {stepIndex + 1} of {SETUP_STEPS.length}
                </span>
              </div>
              <div className="min-h-0 flex-1 px-4 pb-4 sm:px-6 sm:pb-5 xl:overflow-y-auto">
                <StepViewContext.Provider value={viewCtx}>
                  {children}
                </StepViewContext.Provider>
              </div>
            </section>
          </div>
        </div>
      </div>
    </StepSaveContext.Provider>
  )
}
