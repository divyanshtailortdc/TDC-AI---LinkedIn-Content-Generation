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
  loadPictureData = async () => ({}),
  disabled
}: {
  blog: BlogContent
  /** Who wrote it, when, and where it lives: the page's tags and structured data. */
  meta: BlogPageMeta
  /** The featured image as a data URL, loaded only when an export needs it. */
  loadImageData: () => Promise<string | null>
  /** The section pictures as data URLs by id, loaded only when an export needs them. */
  loadPictureData?: () => Promise<Record<string, string>>
  disabled?: boolean
}) {
  const done = (title: string, message?: string) =>
    showToast({ type: 'success', title, message })
  const failed = (title = 'Could not copy', message = 'The browser did not allow it. Use Export instead.') =>
    showToast({ type: 'error', title, message })

  const hasPictures = Object.keys(blog.images ?? {}).length > 0
  /** The blog with its pictures as data, for exports that carry them. */
  const withEmbeddedImage = async (): Promise<BlogContent> => {
    const [dataUrl, pictures] = await Promise.all([
      blog.featuredImage ? loadImageData().catch(() => null) : Promise.resolve(null),
      hasPictures ? loadPictureData().catch(() => ({})) : Promise.resolve({})
    ])
    const images = Object.fromEntries(
      Object.entries(blog.images ?? {}).flatMap(([id, view]) => {
        const src = (pictures as Record<string, string>)[id]
        return src ? [[id, { ...view, src }]] : []
      })
    )
    return {
      ...blog,
      featuredImage:
        blog.featuredImage && dataUrl ? { ...blog.featuredImage, src: dataUrl } : null,
      images
    }
  }
  /** The blog with its pictures named as the image files, for a CMS. */
  const withImageFile = (): BlogContent => {
    const files = figureFiles(blog)
    const featured = files.find(file => file.kind === 'featured')
    const names = new Map(
      files.flatMap(file => (file.kind === 'picture' && file.imageId ? [[file.imageId, file.name] as const] : []))
    )
    return {
      ...blog,
      featuredImage:
        blog.featuredImage && featured
          ? { ...blog.featuredImage, src: featured.name }
          : blog.featuredImage,
      images: Object.fromEntries(
        Object.entries(blog.images ?? {}).flatMap(([id, view]) => {
          const name = names.get(id)
          return name ? [[id, { ...view, src: name }]] : []
        })
      )
    }
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
                () => done('Copied the HTML', 'Pictures are named by file: use Export › Pictures.'),
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
              Promise.all([
                loadImageData().catch(() => null),
                hasPictures ? loadPictureData().catch(() => ({})) : Promise.resolve({})
              ])
                .then(([featuredDataUrl, pictureDataUrls]) =>
                  downloadImages(blog, {
                    featuredDataUrl,
                    pictureDataUrls,
                    diagramColor: meta.diagramColor
                  })
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
