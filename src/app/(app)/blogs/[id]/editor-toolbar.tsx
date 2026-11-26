'use client'

import {
  CALLOUT_LABELS,
  CALLOUT_VARIANTS,
  isSafeHref
} from '@/lib/blogs/doc'
import { cn } from '@/lib/cn'
import {
  useEditorState,
  type ChainedCommands,
  type Editor
} from '@tiptap/react'
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageSquareQuote,
  Pilcrow,
  Quote,
  Redo2,
  Table2,
  Undo2
} from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Menu } from './menu'

/**
 * The document's formatting bar: paragraph, H2, H3, bold, italic, lists,
 * quote, link, tables, labelled boxes, undo and redo. Buttons keep the
 * editor's selection (mousedown does not take focus) and show which formats
 * apply where the cursor is.
 */
export function EditorToolbar({ editor }: { editor: Editor | null }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            editable: current.isEditable,
            paragraph: current.isActive('paragraph'),
            h2: current.isActive('heading', { level: 2 }),
            h3: current.isActive('heading', { level: 3 }),
            bold: current.isActive('bold'),
            italic: current.isActive('italic'),
            bulletList: current.isActive('bulletList'),
            orderedList: current.isActive('orderedList'),
            blockquote: current.isActive('blockquote'),
            link: current.isActive('link'),
            href:
              (current.getAttributes('link').href as string | undefined) ?? '',
            table: current.isActive('table'),
            callout: current.isActive('callout'),
            canUndo: current.can().undo(),
            canRedo: current.can().redo()
          }
        : null
  })
  const [linkOpen, setLinkOpen] = useState(false)
  const [href, setHref] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const inputId = useId()

  const disabled = !editor || !state?.editable
  const run = (command: (chain: ChainedCommands) => ChainedCommands) => () => {
    if (editor) command(editor.chain().focus()).run()
  }

  const openLink = () => {
    setHref(state?.href ?? '')
    setLinkError(null)
    setLinkOpen(true)
  }
  const removeLink = () => {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run()
    setLinkOpen(false)
  }
  const applyLink = () => {
    if (!editor) return
    const raw = href.trim()
    if (!raw) return removeLink()
    const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
    if (!isSafeHref(url)) {
      setLinkError('Use a web address (https://…) or an email link (mailto:…).')
      return
    }
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // Nothing selected: the address goes in as its own linked text.
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          text: url,
          marks: [{ type: 'link', attrs: { href: url } }]
        })
        .run()
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: url })
        .run()
    }
    setLinkOpen(false)
  }

  return (
    <div className="border-border bg-surface/95 sticky top-0 z-10 border-b backdrop-blur">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-0.5 px-2 py-1.5"
      >
        <ToolButton
          label="Paragraph"
          active={state?.paragraph}
          disabled={disabled}
          onClick={run(c => c.setParagraph())}
        >
          <Pilcrow className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          label="Heading 2"
          active={state?.h2}
          disabled={disabled}
          onClick={run(c => c.toggleHeading({ level: 2 }))}
        >
          <Heading2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          label="Heading 3"
          active={state?.h3}
          disabled={disabled}
          onClick={run(c => c.toggleHeading({ level: 3 }))}
        >
          <Heading3 className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <ToolButton
          label="Bold"
          active={state?.bold}
          disabled={disabled}
          onClick={run(c => c.toggleBold())}
        >
          <Bold className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          label="Italic"
          active={state?.italic}
          disabled={disabled}
          onClick={run(c => c.toggleItalic())}
        >
          <Italic className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <ToolButton
          label="Bulleted list"
          active={state?.bulletList}
          disabled={disabled}
          onClick={run(c => c.toggleBulletList())}
        >
          <List className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          label="Numbered list"
          active={state?.orderedList}
          disabled={disabled}
          onClick={run(c => c.toggleOrderedList())}
        >
          <ListOrdered className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          label="Quote"
          active={state?.blockquote}
          disabled={disabled}
          onClick={run(c => c.toggleBlockquote())}
        >
          <Quote className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <ToolButton
          label="Link"
          active={state?.link || linkOpen}
          disabled={disabled}
          onClick={openLink}
        >
          <Link2 className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <Menu
          label="Table"
          align="left"
          icon={<Table2 aria-hidden className="h-4 w-4" />}
          disabled={disabled}
          items={
            state?.table
              ? [
                  { label: 'Add a row below', onSelect: run(c => c.addRowAfter()) },
                  { label: 'Add a column to the right', onSelect: run(c => c.addColumnAfter()) },
                  { label: 'Delete this row', onSelect: run(c => c.deleteRow()) },
                  { label: 'Delete this column', onSelect: run(c => c.deleteColumn()) },
                  { label: 'Delete the table', tone: 'danger' as const, onSelect: run(c => c.deleteTable()) }
                ]
              : [
                  {
                    label: 'Insert a table',
                    onSelect: run(c => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))
                  }
                ]
          }
        />
        <Menu
          label="Box"
          align="left"
          icon={<MessageSquareQuote aria-hidden className="h-4 w-4" />}
          disabled={disabled}
          items={[
            ...CALLOUT_VARIANTS.map(variant => ({
              label: CALLOUT_LABELS[variant],
              onSelect: run(c =>
                state?.callout
                  ? c.updateAttributes('callout', { variant })
                  : c.wrapIn('callout', { variant })
              )
            })),
            ...(state?.callout
              ? [{ label: 'Remove the box', onSelect: run(c => c.lift('callout')) }]
              : [])
          ]}
        />
        <Divider />
        <ToolButton
          label="Undo"
          disabled={disabled || !state?.canUndo}
          onClick={run(c => c.undo())}
        >
          <Undo2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          label="Redo"
          disabled={disabled || !state?.canRedo}
          onClick={run(c => c.redo())}
        >
          <Redo2 className="h-4 w-4" />
        </ToolButton>
      </div>

      {linkOpen && (
        <form
          className="border-border flex flex-wrap items-center gap-2 border-t px-3 py-2"
          onSubmit={event => {
            event.preventDefault()
            applyLink()
          }}
        >
          <label htmlFor={inputId} className="text-muted text-xs font-medium">
            Link to
          </label>
          <input
            id={inputId}
            autoFocus
            value={href}
            onChange={event => {
              setHref(event.target.value)
              setLinkError(null)
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setLinkOpen(false)
                editor?.commands.focus()
              }
            }}
            placeholder="https://example.com/page"
            className="border-border bg-background text-foreground focus:border-brand h-8 min-w-0 flex-1 rounded-md border px-2.5 text-sm outline-none"
          />
          <button
            type="submit"
            className="bg-accent text-background hover:bg-accent-hover h-8 rounded-md px-3 text-xs font-medium"
          >
            Apply
          </button>
          {state?.link && (
            <button
              type="button"
              onClick={removeLink}
              className="border-border text-foreground hover:bg-surface-hover h-8 rounded-md border px-3 text-xs font-medium"
            >
              Remove link
            </button>
          )}
          <button
            type="button"
            onClick={() => setLinkOpen(false)}
            className="text-muted hover:text-foreground h-8 px-2 text-xs"
          >
            Cancel
          </button>
          {linkError && (
            <p
              role="alert"
              className="w-full text-xs text-rose-600 dark:text-rose-400"
            >
              {linkError}
            </p>
          )}
        </form>
      )}
    </div>
  )
}

function ToolButton({
  label,
  active = false,
  disabled,
  onClick,
  children
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      // Keeps the editor's selection: the click must not move focus first.
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'text-muted hover:bg-surface-hover hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active && 'bg-surface-hover text-foreground'
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span aria-hidden className="bg-border mx-1 h-5 w-px" />
}
