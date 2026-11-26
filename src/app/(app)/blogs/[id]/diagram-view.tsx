'use client'

import {
  cleanDiagram,
  DIAGRAM_KIND_LABELS,
  DIAGRAM_KINDS,
  DIAGRAM_LIMITS,
  formatValue,
  renderDiagramSvg,
  type DiagramAttrs,
  type DiagramKind
} from '@/lib/blogs/diagram'
import { cn } from '@/lib/cn'
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps
} from '@tiptap/react'
import { PencilLine, Trash2 } from 'lucide-react'
import { createContext, useContext, useId, useState } from 'react'
import { BlogDialog } from './blog-dialog'

/**
 * A diagram or chart in the editor: drawn from its data exactly as the
 * preview and exports draw it, with Edit (its title, steps or values,
 * caption and alt text) and Remove. The cursor cannot enter it; it moves as
 * one block.
 */

/** The brand colour diagrams are drawn in; the blog page provides it. */
export const DiagramColorContext = createContext<string | undefined>(undefined)

function DiagramView({ node, updateAttributes, deleteNode, selected, editor, getPos }: NodeViewProps) {
  const color = useContext(DiagramColorContext)
  const [editing, setEditing] = useState(false)
  const attrs = cleanDiagram(node.attrs)
  const editable = editor.isEditable
  return (
    <NodeViewWrapper
      as="figure"
      data-drag-handle
      contentEditable={false}
      className={cn(
        'blog-diagram group relative',
        selected && 'ring-brand ring-2 ring-offset-2'
      )}
    >
      {attrs ? (
        <div
          // Drawn by renderDiagramSvg from validated data, every text escaped.
          dangerouslySetInnerHTML={{
            __html: renderDiagramSvg(attrs, { color, idPrefix: `edit-${getPos() ?? 0}` })
          }}
        />
      ) : (
        <p className="text-muted rounded-xl border border-dashed p-4 text-sm">
          This diagram cannot be drawn. Edit it or remove it.
        </p>
      )}
      {attrs?.caption && <figcaption>{attrs.caption}</figcaption>}
      {editable && (
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium shadow-xs"
          >
            <PencilLine aria-hidden className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => deleteNode()}
            aria-label="Remove the diagram"
            className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-7 items-center rounded-md border px-2 shadow-xs"
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {editing && (
        <DiagramDialog
          initial={attrs ?? (node.attrs as DiagramAttrs)}
          onCancel={() => setEditing(false)}
          onSave={next => {
            updateAttributes(next)
            setEditing(false)
          }}
        />
      )}
    </NodeViewWrapper>
  )
}

/** The node view the blog editor draws diagrams with. */
export const diagramNodeView = ReactNodeViewRenderer(DiagramView)

/** One line per step or entry; for a chart, "label | value" per bar. */
const linesOf = (attrs: DiagramAttrs) =>
  attrs.items
    .map((item, i) =>
      attrs.kind === 'bar' ? `${item} | ${attrs.values[i] ?? ''}` : item
    )
    .join('\n')

function parseLines(kind: DiagramKind, text: string) {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  if (kind !== 'bar') return { items: lines, values: [] as Array<string | number> }
  const pairs = lines.map(line => {
    const at = line.lastIndexOf('|')
    return at < 0
      ? { label: line, value: '' }
      : { label: line.slice(0, at).trim(), value: line.slice(at + 1).trim() }
  })
  return { items: pairs.map(p => p.label), values: pairs.map(p => p.value) }
}

function DiagramDialog({
  initial,
  onCancel,
  onSave
}: {
  initial: DiagramAttrs
  onCancel: () => void
  onSave: (attrs: DiagramAttrs) => void
}) {
  const [kind, setKind] = useState<DiagramKind>(initial.kind)
  const [title, setTitle] = useState(initial.title)
  const [lines, setLines] = useState(linesOf(initial))
  const [unit, setUnit] = useState(initial.unit)
  const [caption, setCaption] = useState(initial.caption)
  const [alt, setAlt] = useState(initial.alt)
  const ids = { kind: useId(), title: useId(), lines: useId(), unit: useId(), caption: useId(), alt: useId() }
  const parsed = parseLines(kind, lines)
  const next = cleanDiagram({
    kind,
    title,
    ...parsed,
    unit,
    caption,
    alt,
    sourceId: initial.sourceId
  })
  const max = kind === 'bar' ? DIAGRAM_LIMITS.maxBars : DIAGRAM_LIMITS.maxSteps
  const input =
    'border-border bg-background text-foreground focus:border-brand w-full rounded-lg border px-3 py-2 text-sm outline-none'
  return (
    <BlogDialog
      title="Edit the diagram"
      description="Its words and numbers are drawn exactly as you type them."
      confirmLabel="Save"
      confirmDisabled={!next}
      onCancel={onCancel}
      onConfirm={() => next && onSave(next)}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor={ids.kind} className="text-foreground text-sm font-medium">
            Kind
          </label>
          <select
            id={ids.kind}
            value={kind}
            onChange={event => setKind(event.target.value as DiagramKind)}
            className={input}
          >
            {DIAGRAM_KINDS.map(option => (
              <option key={option} value={option}>
                {DIAGRAM_KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ids.title} className="text-foreground text-sm font-medium">
            Title
          </label>
          <input id={ids.title} value={title} maxLength={DIAGRAM_LIMITS.title} onChange={e => setTitle(e.target.value)} className={input} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ids.lines} className="text-foreground text-sm font-medium">
            {kind === 'bar'
              ? 'Bars, one per line: label | value'
              : kind === 'timeline'
                ? 'Entries, one per line: 2019 — what happened'
                : 'Steps, one per line'}
          </label>
          <textarea id={ids.lines} rows={6} value={lines} onChange={e => setLines(e.target.value)} className={input} />
          <p className="text-muted text-xs">
            2 to {max} lines.
            {kind === 'bar' && next
              ? ` Shown as: ${next.values.map(v => formatValue(v, next.unit)).join(', ')}.`
              : ''}
          </p>
        </div>
        {kind === 'bar' && (
          <div className="space-y-1.5">
            <label htmlFor={ids.unit} className="text-foreground text-sm font-medium">
              Unit (e.g. %, days)
            </label>
            <input id={ids.unit} value={unit} maxLength={DIAGRAM_LIMITS.unit} onChange={e => setUnit(e.target.value)} className={input} />
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor={ids.caption} className="text-foreground text-sm font-medium">
            Caption
          </label>
          <input id={ids.caption} value={caption} maxLength={DIAGRAM_LIMITS.caption} onChange={e => setCaption(e.target.value)} className={input} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ids.alt} className="text-foreground text-sm font-medium">
            Alt text (what it shows, for screen readers)
          </label>
          <input id={ids.alt} value={alt} maxLength={DIAGRAM_LIMITS.alt} onChange={e => setAlt(e.target.value)} className={input} />
        </div>
        {!next && (
          <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
            {kind === 'bar'
              ? 'Give every bar a label and a number, 2 to 10 bars.'
              : 'Give it 2 to 8 lines.'}
          </p>
        )}
      </div>
    </BlogDialog>
  )
}
