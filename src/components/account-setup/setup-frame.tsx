'use client'

import { useSuggestedSections } from '@/components/ai-setup/draft-store'
import { AppHeaderBar } from '@/components/app-header-bar'
import type { SetupSection } from '@/lib/ai/skills/profile-setup/schema'
import { ArrowRight, Loader2, Pencil } from 'lucide-react'
import Link from 'next/link'
import {
  createContext,
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
// Save: the step's form hands its save to the header button
// ---------------------------------------------------------------------------

/** Saves the step; resolves false when it failed and the user should stay. */
type StepSave = () => Promise<boolean> | boolean

const StepSaveContext = createContext<{
  register: (save: StepSave) => () => void
} | null>(null)

/**
 * Lets a form take part in the header's Save. A step can hold several
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
 * and button inside is disabled and drawn as plain read-only text (no box; unchosen options faded), so nothing
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
          : '[&_:is(input,textarea,select):disabled]:bg-transparent [&_:is(input,textarea,select):disabled]:border-transparent [&_:is(input,textarea,select):disabled]:px-0 [&_:is(input,textarea,select):disabled]:shadow-none [&_:is(input,textarea,select):disabled]:appearance-none [&_:is(input,textarea,select):disabled]:text-foreground [&_:is(input,textarea,select):disabled]:cursor-default [&_:is(input,textarea,select):disabled]:opacity-100 [&_[data-edit-only]]:hidden [&_button:disabled]:cursor-default [&_button:disabled]:opacity-100 [&_button[role=radio][aria-checked=false]:disabled]:opacity-35 [&_[role=radiogroup]]:pointer-events-none'
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
      {/* Equal columns, so the circles are evenly spaced whatever the label
          lengths. Each step after the first draws the line back to the one
          before it, at the circles' centre and stopping 6px short of both
          (half a column plus the 14px radius and the gap, either side). */}
      <ol
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${SETUP_STEPS.length}, minmax(0, 1fr))`
        }}
      >
        {SETUP_STEPS.map((step, index) => {
          const active = index === activeIndex
          const Icon = step.icon
          const hasSuggestions = suggested.has(step.key as SetupSection)

          const content = (
            <>
              <span
                className={`relative flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors ${
                  active
                    ? 'bg-accent text-background ring-accent/10 shadow-xs ring-[3px]'
                    : step.optional
                      ? 'border-border bg-surface text-muted group-hover:text-foreground border border-dashed'
                      : 'border-border bg-surface text-muted group-hover:border-accent/40 group-hover:text-foreground border'
                }`}
              >
                {active ? index + 1 : <Icon className="h-3.5 w-3.5" />}
                {hasSuggestions && (
                  <span
                    title="AI suggestions ready"
                    className="ring-surface absolute -top-px -right-px h-2 w-2 rounded-full bg-indigo-500 ring-2"
                  />
                )}
              </span>
              <span
                className={`flex items-center gap-1 text-xs leading-4 whitespace-nowrap transition-colors ${
                  active
                    ? 'text-foreground font-semibold'
                    : 'text-muted group-hover:text-foreground hidden font-medium @min-[60rem]:flex'
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
            <li
              key={step.key}
              className={`relative flex flex-col items-center ${
                index > 0
                  ? 'before:bg-border before:absolute before:top-3.5 before:right-[calc(50%+20px)] before:left-[calc(-50%+20px)] before:h-px'
                  : ''
              }`}
            >
              {accountId ? (
                <Link
                  href={`/accounts/${accountId}${step.path}`}
                  aria-current={active ? 'step' : undefined}
                  className="group flex flex-col items-center gap-1"
                >
                  {content}
                </Link>
              ) : (
                <span
                  aria-current={active ? 'step' : undefined}
                  className="group flex cursor-default flex-col items-center gap-1"
                >
                  {content}
                </span>
              )}
            </li>
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
 * card (who, the steps, theme, Next and Save), then one main card holding the
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
  /** Where the header's Next button goes; none on the last step. */
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
  const step = SETUP_STEPS[stepIndex]!
  const isLast = stepIndex === SETUP_STEPS.length - 1

  const saves = useRef(new Set<StepSave>())
  // Whether any form on this step has something to save from the header; a
  // step whose changes save on the spot (Knowledge) has no Save button.
  const [saveCount, setSaveCount] = useState(0)
  const register = useCallback((save: StepSave) => {
    saves.current.add(save)
    setSaveCount(saves.current.size)
    return () => {
      saves.current.delete(save)
      setSaveCount(saves.current.size)
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

  // Save only saves: the person stays on the step and moves on with Next.
  const saveStep = async () => {
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
    } finally {
      setSaving(false)
    }
  }

  const hasUnsaved = Object.values(views).some(view => view.dirty)
  // Next is for moving on from a saved or untouched step. While a saved step
  // is being edited the header offers Cancel and Save instead.
  const showNext = Boolean(nextHref) && !(viewable && editing)

  return (
    <StepSaveContext.Provider value={ctx}>
      <div className="bg-surface-hover/40 flex h-dvh min-h-0 flex-col">
        <div className="shrink-0">
          {/* Sized by its own width, not the screen's: the app sidebar takes
              part of the screen, so a "wide" screen can still be a narrow header. */}
          <AppHeaderBar
            wide
            actions={
              !isLast ? (
                <>
                  {viewable && editing && (
                    <button
                      type="button"
                      onClick={cancelEditing}
                      disabled={saving}
                      className="border-border text-foreground hover:bg-surface-hover inline-flex h-8 items-center rounded-lg border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  )}
                  {showNext && nextHref && (
                    <Link
                      href={nextHref}
                      aria-disabled={saving}
                      onClick={e => {
                        if (
                          saving ||
                          (hasUnsaved &&
                            !window.confirm(
                              'You have unsaved changes. Leave without saving?'
                            ))
                        ) {
                          e.preventDefault()
                        }
                      }}
                      className="border-border text-foreground hover:bg-surface-hover inline-flex h-8 items-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors aria-disabled:opacity-60"
                    >
                      Next
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                  {viewable && !editing ? (
                    <button
                      type="button"
                      onClick={() => setEdit(true)}
                      className="bg-accent hover:bg-accent-hover text-background inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold whitespace-nowrap shadow-sm transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                  ) : saveCount > 0 ? (
                    <button
                      type="button"
                      onClick={saveStep}
                      disabled={saving}
                      className="bg-accent hover:bg-accent-hover text-background inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold whitespace-nowrap shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  ) : viewable && !hasUnsaved ? (
                    // Nothing to save here: changes were saved as they were
                    // made, so editing just ends.
                    <button
                      type="button"
                      onClick={() => setEdit(false)}
                      className="bg-accent hover:bg-accent-hover text-background inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold whitespace-nowrap shadow-sm transition-colors"
                    >
                      Done
                    </button>
                  ) : null}
                </>
              ) : undefined
            }
          >
            <div className="flex min-w-0 flex-1 items-center gap-3 @min-[56rem]:w-44 @min-[56rem]:flex-none">
              {identity}
            </div>

            <div className="order-last w-full @min-[56rem]:order-0 @min-[56rem]:w-auto @min-[56rem]:min-w-0 @min-[56rem]:flex-1">
              {nav}
            </div>
          </AppHeaderBar>
        </div>

        {/* The frame is always the height of the screen: more data scrolls
            inside the main card, it never makes the frame or the card taller.
            On wide screens the cards sit side by side; on narrower ones the
            assistant stacks above, and the main card keeps a fixed share of
            the screen while the body scrolls between the two. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6 sm:pb-5 xl:overflow-hidden">
          <div
            className={`mx-auto grid h-full gap-5 ${
              aside
                ? 'grid-rows-[auto_minmax(24rem,1fr)] xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-1'
                : 'grid-rows-1'
            }`}
          >
            {/* It still comes first when the cards stack, since the assistant
                is the quickest way to fill the form. */}
            {aside && (
              <aside className="order-first min-h-0 xl:order-last xl:h-full xl:overflow-y-auto">
                {aside}
              </aside>
            )}

            <section className="border-border bg-surface flex min-h-0 min-w-0 flex-col rounded-xl border shadow-xs">
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
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-5">
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
