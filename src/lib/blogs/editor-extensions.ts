import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { mergeAttributes, Node, type NodeViewRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { cleanDiagram } from './diagram'
import { CALLOUT_LABELS, isCalloutVariant, isSafeHref } from './doc'

/**
 * The blog editor's TipTap extensions: exactly what a blog document may hold
 * (src/lib/blogs/doc.ts). The title is the page's only H1, so headings are H2
 * and H3; no code, strikethrough or underline; links only http(s) and mailto,
 * and not followed on click while editing; tables (no column resizing),
 * labelled boxes, diagrams and section pictures. tests/blog-editor-schema.test.ts checks the
 * editor can produce nothing sanitizeDoc refuses.
 */

/**
 * A labelled box: a hypothetical example, key takeaways, a tip, a warning or
 * a note. The label is drawn from the variant (data-label), never typed, so
 * a hypothetical example always says it is one.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: '(paragraph|bulletList|orderedList)+',
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: 'note',
        parseHTML: element => {
          const variant = element.getAttribute('data-callout')
          return isCalloutVariant(variant) ? variant : 'note'
        },
        renderHTML: attributes => {
          const variant = isCalloutVariant(attributes.variant)
            ? attributes.variant
            : 'note'
          return {
            'data-callout': variant,
            'data-label': CALLOUT_LABELS[variant]
          }
        }
      }
    }
  },
  parseHTML() {
    return [{ tag: 'aside[data-callout]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['aside', mergeAttributes(HTMLAttributes, { class: 'blog-callout' }), 0]
  }
})

/**
 * A diagram or chart drawn from its data (src/lib/blogs/diagram.ts): one
 * block the cursor cannot enter. In the app a node view draws it and offers
 * editing; copied out of the editor it is a figure carrying its data, so
 * pasting it back keeps it.
 */
export const Diagram = Node.create<{ view: NodeViewRenderer | null }>({
  name: 'diagram',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return { view: null }
  },
  addAttributes() {
    return {
      kind: { default: 'flow' },
      title: { default: '' },
      items: { default: [] },
      values: { default: [] },
      unit: { default: '' },
      caption: { default: '' },
      alt: { default: '' },
      sourceId: { default: '' }
    }
  },
  parseHTML() {
    return [
      {
        tag: 'figure[data-diagram]',
        getAttrs: element => {
          try {
            return (
              cleanDiagram(
                JSON.parse(element.getAttribute('data-diagram') ?? '')
              ) ?? false
            )
          } catch {
            return false
          }
        }
      }
    ]
  },
  renderHTML({ node }) {
    return [
      'figure',
      { class: 'blog-diagram', 'data-diagram': JSON.stringify(node.attrs) }
    ]
  },
  addNodeView() {
    return this.options.view
  }
})

/**
 * A section picture (blogs.images): one block the cursor cannot enter,
 * naming its picture by id and carrying its alt text and caption. In the app
 * a node view shows it with Edit, Make again and Remove; copied out of the
 * editor it is a figure carrying its id, so pasting it back into the same
 * blog keeps it (another blog's picture is left out when saving).
 */
export const BlogImage = Node.create<{ view: NodeViewRenderer | null }>({
  name: 'image',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return { view: null }
  },
  addAttributes() {
    return {
      imageId: { default: '' },
      alt: { default: '' },
      caption: { default: '' }
    }
  },
  parseHTML() {
    return [
      {
        tag: 'figure[data-blog-image]',
        getAttrs: element => {
          const imageId = element.getAttribute('data-blog-image') ?? ''
          if (!imageId) return false
          return {
            imageId,
            alt: element.getAttribute('data-alt') ?? '',
            caption: element.getAttribute('data-caption') ?? ''
          }
        }
      }
    ]
  },
  renderHTML({ node }) {
    return [
      'figure',
      {
        class: 'blog-image',
        'data-blog-image': String(node.attrs.imageId ?? ''),
        'data-alt': String(node.attrs.alt ?? ''),
        'data-caption': String(node.attrs.caption ?? '')
      }
    ]
  },
  addNodeView() {
    return this.options.view
  }
})

export function blogEditorExtensions(
  options:
    | string
    | {
        placeholder?: string
        diagramView?: NodeViewRenderer | null
        imageView?: NodeViewRenderer | null
      } = {}
) {
  const {
    placeholder = 'Write your blog…',
    diagramView = null,
    imageView = null
  } = typeof options === 'string' ? { placeholder: options } : options
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      code: false,
      codeBlock: false,
      strike: false,
      underline: false,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        protocols: ['http', 'https', 'mailto'],
        isAllowedUri: url => isSafeHref(url)
      }
    }),
    TableKit.configure({ table: { resizable: false } }),
    Callout,
    Diagram.configure({ view: diagramView }),
    BlogImage.configure({ view: imageView }),
    Placeholder.configure({ placeholder })
  ]
}

/**
 * Pasted HTML before the editor reads it. Tables are real tables now, so
 * pasted ones are kept as they are; the hook stays for clean-ups to come.
 */
export function tidyPastedHtml(html: string): string {
  return html
}
