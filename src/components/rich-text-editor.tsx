'use client'

import { blocksToHtml, isSafeLink } from '@/lib/articles/blocks'
import { htmlStringToArticleBlocks } from '@/lib/articles/dom-blocks'
import { cn } from '@/lib/cn'
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Undo2,
  Unlink
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref
} from 'react'

/**
 * A rich-text editor for long-form writing: headings, subheadings,
 * paragraphs, bulleted and numbered lists, quotes, bold, italic and links,
 * from a toolbar or the usual shortcuts. It edits the page's own HTML
 * (contentEditable) and is uncontrolled: it starts from `initialHtml` and
 * the parent reads the content through the handle when it needs it (to save,
 * preview or copy), converting it to article blocks
 * (src/lib/articles/dom-blocks.ts). Remount it (a new `key`) to load
 * different content.
 *
 * Pasted content is reduced to the same blocks before it goes in, so a paste
 * from a web page or a document keeps its structure and none of its styling.
 * The server reduces whatever it receives again on save.
 */

export type RichTextEditorHandle = {
  /** The editable element; null before mount. */
  element: () => HTMLDivElement | null
  focus: () => void
}

type BlockFormat = 'p' | 'h2' | 'h3' | 'blockquote'

type ActiveFormats = {
  block: BlockFormat | null
  bold: boolean
  italic: boolean
  ul: boolean
  ol: boolean
  link: boolean
}

const NONE: ActiveFormats = {
  block: null,
  bold: false,
  italic: false,
  ul: false,
  ol: false,
  link: false
}

// document.execCommand is deprecated but is still the only way to edit
// contentEditable with the browser's own undo history, and every browser
// supports these commands.
function exec(command: string, value?: string) {
  document.execCommand(command, false, value)
}

function isEmpty(el: HTMLElement) {
  return !el.textContent?.trim() && !el.querySelector('li, img')
}

export function RichTextEditor({
  ref,
  initialHtml,
  onChange,
  disabled = false,
  placeholder = 'Write your article…',
  ariaLabel = 'Article body'
}: {
  ref?: Ref<RichTextEditorHandle>
  initialHtml: string
  /** Called on every edit, so the parent can mark unsaved changes. */
  onChange?: () => void
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<ActiveFormats>(NONE)
  const [empty, setEmpty] = useState(!initialHtml.trim())
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  // The selection when the link field opened, restored before the link is applied.
  const savedRange = useRef<Range | null>(null)

  useImperativeHandle(ref, () => ({
    element: () => editorRef.current,
    focus: () => editorRef.current?.focus()
  }))

  // Loaded once: React never re-renders the content, or the caret would jump.
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.innerHTML = initialHtml.trim() || '<p><br></p>'
    setEmpty(isEmpty(el))
    // Run once per mount; the parent remounts to load new content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshActive = useCallback(() => {
    const el = editorRef.current
    const selection = document.getSelection()
    if (!el || !selection || selection.rangeCount === 0) return
    if (!el.contains(selection.anchorNode)) return
    const block = String(document.queryCommandValue('formatBlock') || '')
      .toLowerCase()
      .replace(/[<>]/g, '')
    let node: Node | null = selection.anchorNode
    let inLink = false
    while (node && node !== el) {
      if (node.nodeName === 'A') inLink = true
      node = node.parentNode
    }
    setActive({
      block:
        (['p', 'h2', 'h3', 'blockquote'] as const).find(b => b === block) ??
        (block === 'div' ? 'p' : null),
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      ul: document.queryCommandState('insertUnorderedList'),
      ol: document.queryCommandState('insertOrderedList'),
      link: inLink
    })
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', refreshActive)
    return () => document.removeEventListener('selectionchange', refreshActive)
  }, [refreshActive])

  const changed = () => {
    const el = editorRef.current
    if (el) setEmpty(isEmpty(el))
    onChange?.()
    refreshActive()
  }

  const run = (fn: () => void) => {
    if (disabled) return
    editorRef.current?.focus()
    // New blocks are paragraphs, not divs.
    exec('defaultParagraphSeparator', 'p')
    fn()
    changed()
  }

  const setBlock = (block: BlockFormat) =>
    run(() => {
      // Toggling a heading or quote off makes it a paragraph again.
      const target = active.block === block && block !== 'p' ? 'p' : block
      exec('formatBlock', `<${target}>`)
    })

  const openLink = () => {
    if (disabled) return
    const selection = document.getSelection()
    if (
      !selection ||
      selection.rangeCount === 0 ||
      !editorRef.current?.contains(selection.anchorNode)
    ) {
      editorRef.current?.focus()
      return
    }
    savedRange.current = selection.getRangeAt(0).cloneRange()
    setLinkUrl('https://')
    setLinkError(null)
    setLinkOpen(true)
  }

  const applyLink = () => {
    const url = linkUrl.trim()
    if (!isSafeLink(url)) {
      setLinkError('Use a full https:// address.')
      return
    }
    const selection = document.getSelection()
    editorRef.current?.focus()
    if (savedRange.current && selection) {
      selection.removeAllRanges()
      selection.addRange(savedRange.current)
    }
    run(() => {
      if (selection?.isCollapsed) {
        // No text selected: the address itself becomes the link text.
        const a = document.createElement('a')
        a.href = url
        a.textContent = url
        exec('insertHTML', a.outerHTML)
      } else {
        exec('createLink', url)
      }
    })
    setLinkOpen(false)
  }

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    if (html) {
      const blocks = htmlStringToArticleBlocks(html)
      // A paste of a few words stays inline rather than becoming a paragraph.
      const only = blocks.length === 1 ? blocks[0] : null
      if (only && only.type === 'paragraph') exec('insertHTML', only.text)
      else if (blocks.length > 0) exec('insertHTML', blocksToHtml(blocks))
    } else if (text) {
      const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
      if (paragraphs.length === 1) exec('insertText', text)
      else {
        const div = document.createElement('div')
        exec(
          'insertHTML',
          paragraphs
            .map(p => {
              div.textContent = p.trim()
              return `<p>${div.innerHTML.replace(/\n/g, '<br>')}</p>`
            })
            .join('')
        )
      }
    }
    changed()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      openLink()
    }
    // The page's own shortcuts (save) handle the rest.
  }

  return (
    <div
      className={cn(
        'border-border bg-surface rounded-2xl border shadow-xs',
        disabled && 'opacity-70'
      )}
    >
      <div
        role="toolbar"
        aria-label="Formatting"
        className="border-border bg-surface/95 sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-t-2xl border-b px-2 py-1.5 backdrop-blur"
      >
        <ToolButton
          label="Paragraph"
          active={active.block === 'p'}
          onClick={() => setBlock('p')}
          disabled={disabled}
        >
          <Pilcrow className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          label="Heading"
          active={active.block === 'h2'}
          onClick={() => setBlock('h2')}
          disabled={disabled}
        >
          <Heading2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          label="Subheading"
          active={active.block === 'h3'}
          onClick={() => setBlock('h3')}
          disabled={disabled}
        >
          <Heading3 className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          label="Quote"
          active={active.block === 'blockquote'}
          onClick={() => setBlock('blockquote')}
          disabled={disabled}
        >
          <Quote className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <ToolButton
          label="Bold (Ctrl+B)"
          active={active.bold}
          onClick={() => run(() => exec('bold'))}
          disabled={disabled}
        >
          <Bold className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          label="Italic (Ctrl+I)"
          active={active.italic}
          onClick={() => run(() => exec('italic'))}
          disabled={disabled}
        >
          <Italic className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          label="Bulleted list"
          active={active.ul}
          onClick={() => run(() => exec('insertUnorderedList'))}
          disabled={disabled}
        >
          <List className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          label="Numbered list"
          active={active.ol}
          onClick={() => run(() => exec('insertOrderedList'))}
          disabled={disabled}
        >
          <ListOrdered className="h-4 w-4" />
        </ToolButton>
        <Divider />
        {active.link ? (
          <ToolButton
            label="Remove link"
            active
            onClick={() => run(() => exec('unlink'))}
            disabled={disabled}
          >
            <Unlink className="h-4 w-4" />
          </ToolButton>
        ) : (
          <ToolButton
            label="Link (Ctrl+K)"
            onClick={openLink}
            disabled={disabled}
          >
            <Link2 className="h-4 w-4" />
          </ToolButton>
        )}
        <ToolButton
          label="Clear formatting"
          onClick={() =>
            run(() => {
              exec('removeFormat')
              exec('unlink')
              exec('formatBlock', '<p>')
            })
          }
          disabled={disabled}
        >
          <RemoveFormatting className="h-4 w-4" />
        </ToolButton>
        <span className="ml-auto flex items-center gap-0.5">
          <ToolButton
            label="Undo (Ctrl+Z)"
            onClick={() => run(() => exec('undo'))}
            disabled={disabled}
          >
            <Undo2 className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            label="Redo (Ctrl+Shift+Z)"
            onClick={() => run(() => exec('redo'))}
            disabled={disabled}
          >
            <Redo2 className="h-4 w-4" />
          </ToolButton>
        </span>
        {linkOpen && (
          <form
            className="border-border mt-1 flex w-full flex-wrap items-center gap-2 border-t pt-2"
            onSubmit={e => {
              e.preventDefault()
              applyLink()
            }}
          >
            <label
              htmlFor="rte-link"
              className="text-muted text-xs font-medium"
            >
              Link to
            </label>
            <input
              id="rte-link"
              autoFocus
              type="url"
              value={linkUrl}
              onChange={e => {
                setLinkUrl(e.target.value)
                setLinkError(null)
              }}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setLinkOpen(false)
                  editorRef.current?.focus()
                }
              }}
              className="border-border bg-surface-hover text-foreground focus:border-accent h-8 min-w-0 flex-1 rounded-lg border px-2.5 text-sm outline-none"
            />
            <button
              type="submit"
              className="bg-accent text-background hover:bg-accent-hover h-8 rounded-lg px-3 text-xs font-semibold"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setLinkOpen(false)}
              className="text-muted hover:text-foreground h-8 rounded-lg px-2 text-xs font-medium"
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

      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        data-placeholder={placeholder}
        data-empty={empty}
        onInput={changed}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onFocus={() => exec('defaultParagraphSeparator', 'p')}
        className="article-prose relative min-h-[24rem] px-5 py-5 sm:px-8 sm:py-6"
      />
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
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keeps the editor's selection: a click would otherwise move focus.
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-50',
        active
          ? 'bg-accent text-background'
          : 'text-muted hover:bg-surface-hover hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span aria-hidden className="bg-border mx-1 h-5 w-px" />
}
