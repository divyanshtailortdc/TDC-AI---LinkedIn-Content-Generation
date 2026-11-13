'use client'

import { markDataChanged } from '@/components/refresh-on-back'
import {
  CONTENT_LAYOUTS,
  SLIDE_LAYOUT_LABELS,
  SLIDE_TEXT,
  type SlideLayout,
  type SlideView
} from '@/lib/carousel/types'
import { carouselSpecOf, slideCountRange, type FormatId } from '@/lib/formats'
import { ICON_NAMES } from '@/lib/media/canvas/icon-names'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CircleStop,
  Download,
  ImageMinus,
  ImagePlus,
  Layers,
  Loader2,
  Paintbrush,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useRef, useState } from 'react'

/**
 * A carousel post's slides, each edited on its own: its words, layout and
 * picture prompt by hand (drawn again at once, no AI), written again by AI
 * with an instruction, given a new picture or none, moved, removed; slides
 * added; the whole carousel written again; every slide drawn again in the
 * brand as it now is; and all of them downloaded. The caption is edited
 * apart, in the post's text editor.
 */

type Busy = { slideId: string | null; label: string; stoppable: boolean } | null

interface SlidesPanelProps {
  postId: string
  formatId: FormatId
  slides: SlideView[] | null
  loading: boolean
  onSlidesChange: (slides: SlideView[]) => void
  /** A whole carousel made: its slides and the post's checks run again. */
  onGenerated: (result: {
    slides: SlideView[]
    lintFindings?: unknown[]
    issues?: string[]
  }) => void
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  /** Published or posted: the slides that went out stay as they are. */
  locked: boolean
  /** Whether the brand's image style draws pictures (not minimal graphic design). */
  drawsPictures: boolean
  /**
   * Why the post's slides could not be loaded. The panel then offers to try
   * again, never to make slides: the post has some, and making new ones
   * would cost money and write over them.
   */
  loadError?: string | null
  onRetryLoad?: () => void
}

async function call<T>(
  url: string,
  init: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, ...rest } = init
  const res = await fetch(url, {
    ...rest,
    ...(json !== undefined
      ? {
          body: JSON.stringify(json),
          headers: { 'Content-Type': 'application/json' }
        }
      : {})
  })
  const body = (await res.json().catch(() => null)) as
    ({ success?: boolean; error?: string } & T) | null
  if (!res.ok || !body?.success) {
    throw new Error(body?.error || `The request failed (${res.status}).`)
  }
  return body
}

const isAbort = (err: unknown) =>
  err instanceof DOMException && err.name === 'AbortError'

export function SlidesPanel({
  postId,
  formatId,
  slides,
  loading,
  onSlidesChange,
  onGenerated,
  activeIndex,
  onActiveIndexChange,
  locked,
  drawsPictures,
  loadError,
  onRetryLoad
}: SlidesPanelProps) {
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [rewritingId, setRewritingId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [carouselInstruction, setCarouselInstruction] = useState('')
  const [showRegenerate, setShowRegenerate] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const spec = carouselSpecOf(formatId)
  const range = slideCountRange(formatId)
  const base = `/api/posts/${postId}/slides`
  const list = slides ?? []
  const disabled = locked || busy !== null

  const run = async (
    label: string,
    slideId: string | null,
    stoppable: boolean,
    work: (signal: AbortSignal) => Promise<void>
  ) => {
    const controller = new AbortController()
    abortRef.current = controller
    setBusy({ slideId, label, stoppable })
    setError(null)
    try {
      await work(controller.signal)
      markDataChanged()
    } catch (err) {
      if (!isAbort(err))
        setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      abortRef.current = null
      setBusy(null)
    }
  }

  const replaceSlide = (slide: SlideView) =>
    onSlidesChange(list.map(s => (s.id === slide.id ? slide : s)))

  const generate = (instructionText: string | null) =>
    run(
      list.length
        ? 'Writing the slides again…'
        : 'Writing and drawing the slides…',
      null,
      true,
      async signal => {
        const result = await call<{
          slides: SlideView[]
          issues: string[]
          lintFindings: unknown[]
          existing: boolean
        }>(base, {
          method: 'POST',
          signal,
          // Only the slides shown here are written over (Write again); a
          // post whose slides this screen does not have keeps them.
          json: {
            action: 'generate',
            instruction: instructionText,
            replace: list.length > 0
          }
        })
        setNotes(
          result.existing
            ? [
                'This post already had slides, so nothing new was made. Use Write again to replace them.'
              ]
            : (result.issues ?? [])
        )
        setShowRegenerate(false)
        setCarouselInstruction('')
        onActiveIndexChange(0)
        onGenerated(result)
      }
    )

  const slideAction = (
    slide: SlideView,
    label: string,
    stoppable: boolean,
    json: unknown
  ) =>
    run(label, slide.id, stoppable, async signal => {
      const result = await call<{ slide?: SlideView; slides?: SlideView[] }>(
        `${base}/${slide.id}`,
        {
          method: 'POST',
          signal,
          json
        }
      )
      if (result.slides) onSlidesChange(result.slides)
      else if (result.slide) replaceSlide(result.slide)
    })

  const remove = (slide: SlideView) => {
    if (
      !window.confirm(
        `Delete slide ${slide.position}? The slides after it move up.`
      )
    )
      return
    void run('Deleting the slide…', slide.id, false, async () => {
      const result = await call<{ slides: SlideView[] }>(
        `${base}/${slide.id}`,
        { method: 'DELETE' }
      )
      onSlidesChange(result.slides)
      onActiveIndexChange(
        Math.max(0, Math.min(activeIndex, result.slides.length - 1))
      )
    })
  }

  const add = () =>
    run('Adding a slide…', null, false, async () => {
      const after = Math.max(1, Math.min(activeIndex + 1, list.length - 1))
      const result = await call<{ slides: SlideView[] }>(base, {
        method: 'POST',
        json: { action: 'add', after }
      })
      onSlidesChange(result.slides)
      const added = result.slides.find(s => !list.some(old => old.id === s.id))
      if (added) {
        onActiveIndexChange(added.position - 1)
        setEditingId(added.id)
      }
    })

  const redraw = () =>
    run('Drawing every slide in your brand…', null, false, async () => {
      const result = await call<{ slides: SlideView[] }>(base, {
        method: 'POST',
        json: { action: 'redraw' }
      })
      onSlidesChange(result.slides)
    })

  // -------------------------------------------------------------- render

  if (loading && !slides) {
    return (
      <div className="text-muted flex items-center gap-2 p-2 text-xs">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading slides…
      </div>
    )
  }

  const busyBanner = busy && (
    <div className="border-accent/30 bg-accent/5 text-foreground flex items-center justify-between gap-2 rounded-xl border p-3 text-xs">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="text-accent h-4 w-4 animate-spin" />
        {busy.label}
      </span>
      {busy.stoppable && (
        <button
          type="button"
          onClick={() => abortRef.current?.abort()}
          className="text-muted hover:text-foreground inline-flex cursor-pointer items-center gap-1 font-medium"
        >
          <CircleStop className="h-3.5 w-3.5" /> Stop
        </button>
      )}
    </div>
  )

  const errorBanner = error && (
    <div className="flex items-start justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400">
      <span>{error}</span>
      <button
        type="button"
        onClick={() => setError(null)}
        aria-label="Dismiss"
        className="cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )

  if (loadError && list.length === 0) {
    return (
      <div className="space-y-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-600 dark:text-rose-400">
        <p className="flex gap-1.5 font-semibold">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          The slides could not be loaded
        </p>
        <p className="leading-relaxed">{loadError}</p>
        {onRetryLoad && (
          <button
            type="button"
            onClick={onRetryLoad}
            className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 font-semibold"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        )}
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <div className="space-y-3">
        {errorBanner}
        {busy ? (
          busyBanner
        ) : (
          <div className="border-border space-y-3 rounded-xl border border-dashed p-4 text-center">
            <Layers className="text-accent mx-auto h-6 w-6" />
            <p className="text-foreground text-sm font-semibold">
              Make this post a carousel
            </p>
            <p className="text-muted text-xs leading-relaxed">
              AI writes a cover, {range.min - 2}–{range.max - 2} slides with one
              point each and a closing call to action, beside your caption
              (never a copy of it), and draws them in your brand.
              {drawsPictures
                ? ' The cover gets a picture; the rest are designed in your colours.'
                : ''}
            </p>
            <button
              type="button"
              disabled={locked}
              onClick={() => void generate(null)}
              className="bg-accent text-background hover:bg-accent-hover inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" /> Make slides
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {errorBanner}
      {busyBanner}
      {notes.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          {notes.map(note => (
            <li key={note} className="flex gap-1.5">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              {note}
            </li>
          ))}
        </ul>
      )}

      {/* The whole carousel */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="text-muted">
          {list.length} slides
          {spec ? ` · ${spec.minSlides}–${spec.maxSlides} allowed` : ''}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {!locked && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setShowRegenerate(v => !v)}
              className="text-accent inline-flex cursor-pointer items-center gap-1 font-medium hover:underline disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Write again
            </button>
          )}
          {!locked && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void redraw()}
              title="Draw every slide again with your current Brand Theme (no AI)"
              className="text-muted hover:text-foreground inline-flex cursor-pointer items-center gap-1 font-medium disabled:opacity-50"
            >
              <Paintbrush className="h-3.5 w-3.5" /> Redraw
            </button>
          )}
          <a
            href={`${base}/download?as=zip`}
            download
            className="text-muted hover:text-foreground inline-flex items-center gap-1 font-medium"
          >
            <Download className="h-3.5 w-3.5" /> Images
          </a>
          <a
            href={`${base}/download?as=pdf`}
            download
            className="text-muted hover:text-foreground inline-flex items-center gap-1 font-medium"
          >
            <Download className="h-3.5 w-3.5" /> PDF
          </a>
        </span>
      </div>

      {showRegenerate && !locked && (
        <div className="border-border space-y-2 rounded-xl border p-3">
          <label
            className="text-foreground block text-xs font-semibold"
            htmlFor="carousel-instruction"
          >
            Write every slide again
          </label>
          <textarea
            id="carousel-instruction"
            value={carouselInstruction}
            onChange={e =>
              setCarouselInstruction(e.target.value.slice(0, 1000))
            }
            rows={2}
            placeholder="Optional: what to change, e.g. “fewer slides, one per step” or “more figures”"
            className="border-border bg-surface text-foreground placeholder:text-muted focus:border-accent w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none"
          />
          <p className="text-muted text-[11px]">
            Replaces every slide, and your edits to them. The caption stays.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowRegenerate(false)}
              className="text-muted hover:text-foreground cursor-pointer px-2 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void generate(carouselInstruction.trim() || null)}
              className="bg-accent text-background hover:bg-accent-hover inline-flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" /> Write slides
            </button>
          </div>
        </div>
      )}

      <ol className="space-y-2">
        {list.map((slide, i) => (
          <SlideRow
            key={slide.id}
            slide={slide}
            index={i}
            total={list.length}
            active={i === activeIndex}
            busyLabel={busy?.slideId === slide.id ? busy.label : null}
            disabled={disabled}
            locked={locked}
            editing={editingId === slide.id}
            rewriting={rewritingId === slide.id}
            instruction={instruction}
            onInstruction={setInstruction}
            onSelect={() => onActiveIndexChange(i)}
            onEdit={() => {
              setEditingId(slide.id)
              setRewritingId(null)
              onActiveIndexChange(i)
            }}
            onCancelEdit={() => setEditingId(null)}
            onSave={patch =>
              run(
                'Saving and drawing the slide…',
                slide.id,
                false,
                async () => {
                  const result = await call<{ slide: SlideView }>(
                    `${base}/${slide.id}`,
                    {
                      method: 'PATCH',
                      json: patch
                    }
                  )
                  replaceSlide(result.slide)
                  setEditingId(null)
                }
              )
            }
            onToggleRewrite={() => {
              setRewritingId(id => (id === slide.id ? null : slide.id))
              setEditingId(null)
              setInstruction('')
              onActiveIndexChange(i)
            }}
            onRewrite={() => {
              setRewritingId(null)
              void slideAction(slide, 'Writing the slide again…', true, {
                action: 'rewrite',
                instruction: instruction.trim() || null
              })
            }}
            onPicture={() =>
              void slideAction(
                slide,
                slide.hasPicture
                  ? 'Making a new picture…'
                  : 'Making a picture…',
                true,
                {
                  action: 'picture'
                }
              )
            }
            onRemovePicture={() =>
              void slideAction(slide, 'Removing the picture…', false, {
                action: 'remove_picture'
              })
            }
            onMove={direction =>
              void slideAction(slide, 'Moving the slide…', false, {
                action: 'move',
                direction
              }).then(() =>
                onActiveIndexChange(direction === 'up' ? i - 1 : i + 1)
              )
            }
            onDelete={() => remove(slide)}
            canMoveUp={
              slide.role === 'content' && list[i - 1]?.role === 'content'
            }
            canMoveDown={
              slide.role === 'content' && list[i + 1]?.role === 'content'
            }
            canDelete={
              slide.role === 'content' && list.length > (spec?.minSlides ?? 2)
            }
          />
        ))}
      </ol>

      {!locked && spec && list.length < spec.maxSlides && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => void add()}
          className="border-border text-muted hover:text-foreground hover:bg-surface-hover flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed py-2 text-xs font-medium disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add a slide after slide{' '}
          {Math.max(1, Math.min(activeIndex + 1, list.length - 1))}
        </button>
      )}
    </div>
  )
}

// ----------------------------------------------------------------- a slide

interface SlidePatch {
  headline: string
  body: string
  imagePrompt: string
  design: { layout: SlideLayout; icon?: string | null; stat?: string | null }
}

function SlideRow(props: {
  slide: SlideView
  index: number
  total: number
  active: boolean
  busyLabel: string | null
  disabled: boolean
  locked: boolean
  editing: boolean
  rewriting: boolean
  instruction: string
  onInstruction: (value: string) => void
  onSelect: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onSave: (patch: SlidePatch) => void
  onToggleRewrite: () => void
  onRewrite: () => void
  onPicture: () => void
  onRemovePicture: () => void
  onMove: (direction: 'up' | 'down') => void
  onDelete: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  canDelete: boolean
}) {
  const { slide } = props
  const roleLabel =
    slide.role === 'cover'
      ? 'Cover'
      : slide.role === 'cta'
        ? 'Call to action'
        : SLIDE_LAYOUT_LABELS[slide.design.layout]
  const iconButton =
    'text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <li
      className={`rounded-xl border p-2.5 transition-colors ${props.active ? 'border-accent/50 bg-accent/5' : 'border-border bg-surface'}`}
    >
      <div className="flex gap-3">
        <button
          type="button"
          onClick={props.onSelect}
          aria-label={`Show slide ${slide.position}`}
          className="bg-surface-hover relative aspect-4/5 w-16 shrink-0 cursor-pointer overflow-hidden rounded-md"
        >
          {slide.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={slide.imageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-muted absolute inset-0 flex items-center justify-center text-[10px]">
              {slide.status === 'failed' ? 'Not drawn' : '…'}
            </span>
          )}
          {props.busyLabel && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-muted flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase">
            <span className="tabular-nums">{slide.position}</span>
            <span>·</span>
            <span className="truncate">{roleLabel}</span>
            {slide.hasPicture && <span className="normal-case">· picture</span>}
          </div>
          <p className="text-foreground mt-0.5 line-clamp-2 text-[13px] leading-snug font-semibold">
            {slide.headline}
          </p>
          {slide.body && (
            <p className="text-muted mt-0.5 line-clamp-2 text-xs leading-snug whitespace-pre-line">
              {slide.body}
            </p>
          )}
          {(slide.error || slide.issues.length > 0) && (
            <p className="mt-1 flex gap-1 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              {slide.error ?? slide.issues[0]}
            </p>
          )}
        </div>
      </div>

      {!props.locked && !props.editing && (
        <div className="mt-1.5 flex flex-wrap items-center gap-0.5 pl-[4.75rem]">
          <button
            type="button"
            disabled={props.disabled}
            onClick={props.onEdit}
            className={iconButton}
            title="Edit this slide"
            aria-label="Edit this slide"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={props.disabled}
            onClick={props.onToggleRewrite}
            className={iconButton}
            title="Write this slide again with AI"
            aria-label="Write this slide again with AI"
          >
            <Sparkles className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={props.disabled}
            onClick={props.onPicture}
            className={iconButton}
            title={
              slide.hasPicture
                ? 'New picture from its prompt'
                : 'Add a picture from its prompt'
            }
            aria-label={slide.hasPicture ? 'New picture' : 'Add a picture'}
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </button>
          {slide.hasPicture && (
            <button
              type="button"
              disabled={props.disabled}
              onClick={props.onRemovePicture}
              className={iconButton}
              title="Remove the picture"
              aria-label="Remove the picture"
            >
              <ImageMinus className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            disabled={props.disabled || !props.canMoveUp}
            onClick={() => props.onMove('up')}
            className={iconButton}
            title="Move up"
            aria-label="Move up"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={props.disabled || !props.canMoveDown}
            onClick={() => props.onMove('down')}
            className={iconButton}
            title="Move down"
            aria-label="Move down"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={props.disabled || !props.canDelete}
            onClick={props.onDelete}
            className={`${iconButton} hover:text-rose-600`}
            title={
              props.canDelete
                ? 'Delete this slide'
                : 'The cover and the last slide stay'
            }
            aria-label="Delete this slide"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {props.rewriting && !props.locked && (
        <div className="mt-2 space-y-2 pl-[4.75rem]">
          <input
            value={props.instruction}
            onChange={e => props.onInstruction(e.target.value.slice(0, 1000))}
            onKeyDown={e => e.key === 'Enter' && props.onRewrite()}
            placeholder="Optional: what to change, e.g. “shorter”, “use the 43% figure”"
            className="border-border bg-surface text-foreground placeholder:text-muted focus:border-accent w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={props.onToggleRewrite}
              className="text-muted hover:text-foreground cursor-pointer px-2 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={props.disabled}
              onClick={props.onRewrite}
              className="bg-accent text-background hover:bg-accent-hover inline-flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" /> Write again
            </button>
          </div>
        </div>
      )}

      {props.editing && !props.locked && (
        <SlideEditor
          slide={slide}
          disabled={props.disabled}
          onCancel={props.onCancelEdit}
          onSave={props.onSave}
        />
      )}
    </li>
  )
}

function SlideEditor({
  slide,
  disabled,
  onCancel,
  onSave
}: {
  slide: SlideView
  disabled: boolean
  onCancel: () => void
  onSave: (patch: SlidePatch) => void
}) {
  const [headline, setHeadline] = useState(slide.headline)
  const [body, setBody] = useState(slide.body)
  const [imagePrompt, setImagePrompt] = useState(slide.imagePrompt)
  const [layout, setLayout] = useState<SlideLayout>(slide.design.layout)
  const [icon, setIcon] = useState(slide.design.icon ?? 'target')
  const [stat, setStat] = useState(slide.design.stat ?? '')
  const field =
    'border-border bg-surface text-foreground placeholder:text-muted focus:border-accent w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none'
  const count = (n: number, soft: number) => (
    <span
      className={`tabular-nums ${n > soft ? 'text-amber-600 dark:text-amber-400' : ''}`}
    >
      {n}/{soft}
    </span>
  )

  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={e => {
        e.preventDefault()
        onSave({
          headline,
          body,
          imagePrompt,
          design: {
            layout,
            icon: layout === 'icon' ? icon : null,
            stat: layout === 'stat' ? stat : null
          }
        })
      }}
    >
      <label className="block space-y-1">
        <span className="text-muted flex justify-between text-[11px] font-medium">
          Headline {count(headline.length, SLIDE_TEXT.headline.soft)}
        </span>
        <input
          value={headline}
          onChange={e => setHeadline(e.target.value)}
          className={field}
          required
        />
      </label>
      <label className="block space-y-1">
        <span className="text-muted flex justify-between text-[11px] font-medium">
          {layout === 'list'
            ? 'Points, one per line'
            : layout === 'quote'
              ? 'Quote'
              : 'Text'}{' '}
          {count(body.length, SLIDE_TEXT.body.soft)}
        </span>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={3}
          className={field}
        />
      </label>
      {slide.role === 'content' && (
        <div className="flex flex-wrap gap-2">
          <label className="min-w-32 flex-1 space-y-1">
            <span className="text-muted block text-[11px] font-medium">
              Layout
            </span>
            <select
              value={layout}
              onChange={e => setLayout(e.target.value as SlideLayout)}
              className={field}
            >
              {CONTENT_LAYOUTS.map(l => (
                <option key={l} value={l}>
                  {SLIDE_LAYOUT_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
          {layout === 'icon' && (
            <label className="min-w-32 flex-1 space-y-1">
              <span className="text-muted block text-[11px] font-medium">
                Icon
              </span>
              <select
                value={icon}
                onChange={e => setIcon(e.target.value as typeof icon)}
                className={field}
              >
                {ICON_NAMES.map(name => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {layout === 'stat' && (
            <label className="min-w-24 flex-1 space-y-1">
              <span className="text-muted block text-[11px] font-medium">
                Figure
              </span>
              <input
                value={stat}
                onChange={e => setStat(e.target.value.slice(0, 12))}
                placeholder="43%"
                className={field}
                required
              />
            </label>
          )}
        </div>
      )}
      <label className="block space-y-1">
        <span className="text-muted block text-[11px] font-medium">
          Picture prompt (used by Add picture)
        </span>
        <textarea
          value={imagePrompt}
          onChange={e => setImagePrompt(e.target.value)}
          rows={2}
          className={field}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-muted hover:text-foreground cursor-pointer px-2 text-xs"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={disabled || !headline.trim()}
          className="bg-accent text-background hover:bg-accent-hover cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          Save slide
        </button>
      </div>
    </form>
  )
}
