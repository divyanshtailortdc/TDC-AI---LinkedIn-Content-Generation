import { renderDiagramSvg } from './diagram'
import {
  blogArticleHtml,
  blogToMarkdown,
  blogToText,
  figureFiles
} from './render'
import type { BlogContent } from './types'

/**
 * Getting a blog out of the browser: onto the clipboard and into files.
 * Browser-only; the formats themselves are built by ./render.ts. Pictures go
 * where each destination can show them: documents get PNG images inline,
 * a page gets them embedded, a CMS gets the files to upload.
 */

/** Plain text onto the clipboard, with a fallback for browsers without the API. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}

/** Diagrams are drawn this wide in pixels as PNG: sharp on a high-density screen. */
const PNG_WIDTH = 1440

/** An SVG drawn onto a canvas, as a PNG data URL. */
export async function svgToPng(svg: string, width = PNG_WIDTH): Promise<string> {
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  const ratio = viewBox ? Number(viewBox[2]) / Number(viewBox[1]) : 0.5
  const height = Math.round(width * ratio)
  // An image needs a size of its own; the page's SVG says width="100%".
  const sized = svg.replace('width="100%"', `width="${width}" height="${height}"`)
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('The diagram could not be drawn.'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The diagram could not be drawn.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The article's HTML with every diagram as a PNG image, for documents that do not take SVG. */
async function htmlWithPngDiagrams(html: string): Promise<string> {
  const figures = [...html.matchAll(/<svg [\s\S]*?<\/svg>/g)]
  let out = html
  for (const [svg] of figures) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(svg)?.[1] ?? ''
    const desc = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(svg)?.[1] ?? title
    const png = await svgToPng(svg).catch(() => null)
    if (png) out = out.replace(svg, `<img src="${png}" alt="${desc}" width="720">`)
  }
  return out
}

/**
 * The article as formatted text (HTML, with plain text beside it), so it
 * pastes with its headings, lists, links, tables and pictures into a CMS,
 * Google Docs or Word. 'text' when the browser could only take text:
 * Markdown is copied then.
 */
export async function copyFormatted(
  blog: BlogContent,
  options: { diagramColor?: string } = {}
): Promise<'html' | 'text'> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const html = await htmlWithPngDiagrams(
        blogArticleHtml(blog, { diagramColor: options.diagramColor })
      )
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([blogToText(blog)], { type: 'text/plain' })
        })
      ])
      return 'html'
    } catch {
      // Not allowed here (an insecure page, say): Markdown instead.
    }
  }
  await copyText(blogToMarkdown(blog, { frontMatter: false }))
  return 'text'
}

/** Saves text as a file the browser downloads. */
export function downloadText(
  fileName: string,
  mime: string,
  text: string
): void {
  downloadUrl(
    fileName,
    URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` })),
    true
  )
}

/** Saves a data URL (or an object URL) as a file the browser downloads. */
export function downloadUrl(fileName: string, url: string, revoke = false): void {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  if (revoke) setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Opens the browser's print window on a complete HTML page, laid out in a
 * hidden frame, where it can be saved as a PDF. The page's title names the
 * file. Resolves once the window has closed (in most browsers: in the rest,
 * once it has opened); the frame goes when printing ends, or at the next print.
 */
export async function printHtml(html: string): Promise<void> {
  document.querySelector('iframe[data-print-frame]')?.remove()
  const frame = document.createElement('iframe')
  frame.dataset.printFrame = ''
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  Object.assign(frame.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    opacity: '0',
    pointerEvents: 'none'
  })
  const loaded = new Promise<void>(resolve => {
    frame.onload = () => resolve()
  })
  frame.srcdoc = html
  document.body.appendChild(frame)
  await loaded
  const view = frame.contentWindow
  const page = frame.contentDocument
  if (!view || !page) {
    frame.remove()
    throw new Error('The page could not be laid out for printing.')
  }
  // Every picture drawn before the pages are laid out.
  await Promise.all(
    Array.from(page.images, image => image.decode().catch(() => {}))
  )
  await page.fonts?.ready
  view.addEventListener('afterprint', () => setTimeout(() => frame.remove()), {
    once: true
  })
  // Some browsers name the PDF after the tab, not the frame printed.
  const tabTitle = document.title
  if (page.title) document.title = page.title
  try {
    view.focus()
    view.print()
  } finally {
    document.title = tabTitle
  }
}

/**
 * Every picture of the blog as a file, named as the Markdown refers to them:
 * the featured image and the section pictures (their data URLs, loaded by
 * the caller) and each diagram drawn as a PNG. Returns how many were saved.
 */
export async function downloadImages(
  blog: BlogContent,
  options: {
    featuredDataUrl: string | null
    /** Section pictures as data URLs, by picture id. */
    pictureDataUrls?: Record<string, string>
    diagramColor?: string
  }
): Promise<number> {
  let saved = 0
  const diagrams = blog.content.content.filter(block => block.type === 'diagram')
  const pause = () => new Promise(resolve => setTimeout(resolve, 250))
  for (const file of figureFiles(blog)) {
    if (file.kind === 'featured') {
      if (!options.featuredDataUrl) continue
      downloadUrl(file.name, options.featuredDataUrl)
      saved++
      continue
    }
    if (file.kind === 'picture') {
      const dataUrl = file.imageId ? options.pictureDataUrls?.[file.imageId] : undefined
      if (!dataUrl) continue
      downloadUrl(file.name, dataUrl)
      saved++
      await pause()
      continue
    }
    const block = diagrams[file.index - 1]
    if (block?.type !== 'diagram') continue
    const png = await svgToPng(
      renderDiagramSvg(block.attrs, { color: options.diagramColor })
    )
    downloadUrl(file.name, png)
    saved++
    // Browsers drop downloads started in the same instant.
    await pause()
  }
  return saved
}
