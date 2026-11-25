'use client'

import { showToast } from '@/components/toast-notification'
import {
  copyFormatted,
  copyText,
  downloadImages,
  downloadText
} from '@/lib/blogs/browser-export'
import {
  blogArticleHtml,
  blogFileName,
  blogJsonLdScript,
  blogToMarkdown,
  blogToStandaloneHtml,
  blogToText,
  figureFiles,
  type BlogPageMeta
} from '@/lib/blogs/render'
import type { BlogContent } from '@/lib/blogs/types'
import {
  Braces,
  Clipboard,
  Code2,
  Download,
  FileCode2,
  FileText,
  Hash,
  Images,
  Type
} from 'lucide-react'
import { Menu } from './menu'

/**
 * Copy and Export for the blog as it stands in the editor (unsaved changes
 * included): formatted for pasting into a CMS or document (pictures inline),
 * Markdown, HTML or the structured data on the clipboard; Markdown with
 * front matter, a complete HTML page (pictures embedded), plain text or the
 * pictures themselves as files named by the slug.
 */
export function ExportMenu({
  blog,
  meta,
  loadImageData,
  disabled
}: {
  blog: BlogContent
  /** Who wrote it, when, and where it lives: the page's tags and structured data. */
  meta: BlogPageMeta
  /** The featured image as a data URL, loaded only when an export needs it. */
  loadImageData: () => Promise<string | null>
  disabled?: boolean
}) {
  const done = (title: string, message?: string) =>
    showToast({ type: 'success', title, message })
  const failed = (title = 'Could not copy', message = 'The browser did not allow it. Use Export instead.') =>
    showToast({ type: 'error', title, message })

  /** The blog with its featured image as data, for exports that carry the picture. */
  const withEmbeddedImage = async (): Promise<BlogContent> => {
    if (!blog.featuredImage) return blog
    const dataUrl = await loadImageData().catch(() => null)
    return dataUrl
      ? { ...blog, featuredImage: { ...blog.featuredImage, src: dataUrl } }
      : { ...blog, featuredImage: null }
  }
  /** The blog with its featured image named as the image file, for a CMS. */
  const withImageFile = (): BlogContent => {
    const featured = figureFiles(blog).find(file => file.kind === 'featured')
    return blog.featuredImage && featured
      ? { ...blog, featuredImage: { ...blog.featuredImage, src: featured.name } }
      : blog
  }
  const options = { diagramColor: meta.diagramColor }

  return (
    <>
      <Menu
        label="Copy"
        icon={<Clipboard aria-hidden className="h-4 w-4" />}
        disabled={disabled}
        items={[
          {
            label: 'Copy formatted',
            icon: <Type aria-hidden className="h-4 w-4" />,
            onSelect: () =>
              withEmbeddedImage()
                .then(embedded => copyFormatted(embedded, options))
                .then(
                  kind =>
                    kind === 'html'
                      ? done('Copied with formatting', 'Paste it into your CMS or document.')
                      : done('Copied as Markdown', 'This browser could only copy text.'),
                  () => failed()
                )
          },
          {
            label: 'Copy Markdown',
            icon: <Hash aria-hidden className="h-4 w-4" />,
            onSelect: () =>
              copyText(blogToMarkdown(blog, { frontMatter: false })).then(
                () => done('Copied as Markdown', 'Pictures are named by file: use Export › Pictures.'),
                () => failed()
              )
          },
          {
            label: 'Copy HTML',
            icon: <Code2 aria-hidden className="h-4 w-4" />,
            onSelect: () =>
              copyText(blogArticleHtml(withImageFile(), options)).then(
                () => done('Copied the HTML', 'The featured image is named by file: use Export › Pictures.'),
                () => failed()
              )
          },
          {
            label: 'Copy structured data',
            icon: <Braces aria-hidden className="h-4 w-4" />,
            onSelect: () =>
              copyText(blogJsonLdScript(blog, meta)).then(
                () => done('Copied the structured data', 'Paste it into your page’s head or custom code field.'),
                () => failed()
              )
          }
        ]}
      />
      <Menu
        label="Export"
        icon={<Download aria-hidden className="h-4 w-4" />}
        disabled={disabled}
        items={[
          {
            label: 'Markdown (.md)',
            icon: <Hash aria-hidden className="h-4 w-4" />,
            onSelect: () => {
              const name = blogFileName(blog, 'md')
              downloadText(name, 'text/markdown', blogToMarkdown(blog))
              done(`Downloaded ${name}`)
            }
          },
          {
            label: 'HTML page (.html)',
            icon: <FileCode2 aria-hidden className="h-4 w-4" />,
            onSelect: () =>
              withEmbeddedImage().then(embedded => {
                const name = blogFileName(blog, 'html')
                downloadText(name, 'text/html', blogToStandaloneHtml(embedded, meta))
                done(`Downloaded ${name}`, 'Pictures are embedded in the page.')
              })
          },
          {
            label: 'Plain text (.txt)',
            icon: <FileText aria-hidden className="h-4 w-4" />,
            onSelect: () => {
              const name = blogFileName(blog, 'txt')
              downloadText(name, 'text/plain', blogToText(blog))
              done(`Downloaded ${name}`)
            }
          },
          {
            label: 'Pictures',
            icon: <Images aria-hidden className="h-4 w-4" />,
            disabled: figureFiles(blog).length === 0,
            onSelect: () =>
              loadImageData()
                .catch(() => null)
                .then(featuredDataUrl =>
                  downloadImages(blog, { featuredDataUrl, diagramColor: meta.diagramColor })
                )
                .then(
                  count => done(`Downloaded ${count} picture${count === 1 ? '' : 's'}`),
                  () => failed('Could not save the pictures', 'Try again, or save them from the preview.')
                )
          }
        ]}
      />
    </>
  )
}
