'use client'

import { docSignature, plainDoc, type BlogDoc } from '@/lib/blogs/doc'
import {
  blogEditorExtensions,
  tidyPastedHtml
} from '@/lib/blogs/editor-extensions'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import { diagramNodeView } from './diagram-view'
import { imageNodeView } from './image-view'
import { EditorToolbar } from './editor-toolbar'

/**
 * The blog's body as a rich-text document (TipTap), with its formatting bar.
 * It reports every change as document JSON. A `value` that differs from
 * what it last reported (a restored version, a rewritten section) replaces
 * the content; its own text coming back from a save does not, so the cursor
 * stays where it was.
 */
export function DocEditor({
  value,
  editable,
  onChange,
  onEditor,
  placeholder
}: {
  value: BlogDoc
  editable: boolean
  onChange: (doc: BlogDoc) => void
  /** The editor once it exists, for scrolling to a heading. */
  onEditor?: (editor: Editor | null) => void
  placeholder?: string
}) {
  const reported = useRef(docSignature(value))
  const changed = useRef(onChange)
  useEffect(() => {
    changed.current = onChange
  }, [onChange])

  const editor = useEditor({
    extensions: blogEditorExtensions({
      placeholder,
      diagramView: diagramNodeView,
      imageView: imageNodeView
    }),
    content: value,
    editable,
    // Rendered on the client only: the server has no editor to render.
    immediatelyRender: false,
    editorProps: {
      transformPastedHTML: tidyPastedHtml,
      attributes: {
        class: 'blog-doc min-h-[50vh] px-1 py-4',
        'aria-label': 'Blog text',
        role: 'textbox',
        'aria-multiline': 'true'
      }
    },
    onUpdate: ({ editor: current }) => {
      // Plain objects: a server action cannot send ProseMirror's attrs.
      const doc = plainDoc(current.getJSON())
      reported.current = docSignature(doc)
      changed.current(doc)
    }
  })

  useEffect(() => {
    if (!editor) return
    const next = docSignature(value)
    if (next === reported.current) return
    reported.current = next
    editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, value])

  useEffect(() => {
    // No update event: toggling editability changes no text.
    editor?.setEditable(editable, false)
  }, [editor, editable])

  useEffect(() => {
    onEditor?.(editor ?? null)
    return () => onEditor?.(null)
  }, [editor, onEditor])

  return (
    <div>
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}
