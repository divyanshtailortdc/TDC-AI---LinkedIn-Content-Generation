/**
 * A carousel as a PDF, one slide per page: what LinkedIn takes as a document
 * post (its swipeable carousel) and what "Download PDF" gives. Each page is
 * a JPEG embedded as it is (/DCTDecode), so no PDF library is needed and the
 * slide is not re-encoded a second time. Pure: no sharp, no file system; the
 * caller hands over JPEG bytes (./export makes them).
 */

export interface PdfPage {
  jpeg: Buffer
  /** The page's size in points; a slide's pixel size, one pixel a point. */
  width: number
  height: number
}

/** What a JPEG's frame header says: its pixel size and colour components. */
function readJpegFrame(jpeg: Buffer): {
  width: number
  height: number
  components: number
} {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error('A PDF page must be a JPEG image.')
  }
  let at = 2
  while (at + 4 <= jpeg.length) {
    if (jpeg[at] !== 0xff) {
      at++
      continue
    }
    const marker = jpeg[at + 1]!
    // Fill bytes, and markers that carry no length.
    if (marker === 0xff) {
      at++
      continue
    }
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      at += 2
      continue
    }
    const length = jpeg.readUInt16BE(at + 2)
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      if (at + 9 >= jpeg.length) break
      return {
        height: jpeg.readUInt16BE(at + 5),
        width: jpeg.readUInt16BE(at + 7),
        components: jpeg[at + 9]!
      }
    }
    // Start of scan: the frame header always comes before it.
    if (marker === 0xda) break
    at += 2 + length
  }
  throw new Error('The JPEG has no frame header.')
}

const COLOUR_SPACES: Record<number, string> = {
  1: '/DeviceGray',
  3: '/DeviceRGB',
  // Adobe's CMYK JPEGs store their channels inverted.
  4: '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]'
}

/**
 * A PDF string for document info: a literal with its specials escaped when
 * it is plain printable ASCII, otherwise UTF-16BE in hex, which every reader
 * takes for any script.
 */
export function pdfString(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) {
    return `(${text.replace(/[\\()]/g, ch => `\\${ch}`)})`
  }
  const units: string[] = ['FEFF']
  for (let i = 0; i < text.length; i++) {
    units.push(text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase())
  }
  return `<${units.join('')}>`
}

const num = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')

export function jpegPagesToPdf(
  pages: PdfPage[],
  meta: { title?: string } = {}
): Buffer {
  if (pages.length === 0) throw new Error('A PDF needs at least one page.')

  // Objects: 1 catalog, 2 page tree, then per page its page, content stream
  // and image, then the document info.
  const pageObj = (i: number) => 3 + i * 3
  const infoObj = 3 + pages.length * 3
  const chunks: Buffer[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: string | Buffer) => {
    const buffer = typeof part === 'string' ? Buffer.from(part, 'latin1') : part
    chunks.push(buffer)
    length += buffer.length
  }
  const open = (id: number) => {
    offsets[id] = length
    push(`${id} 0 obj\n`)
  }

  // The second line's high bytes tell transfer tools the file is binary.
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')

  open(1)
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  open(2)
  push(
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`
  )

  pages.forEach((page, i) => {
    const frame = readJpegFrame(page.jpeg)
    const colour = COLOUR_SPACES[frame.components]
    if (!colour)
      throw new Error(
        `A JPEG with ${frame.components} colour components cannot go in a PDF.`
      )
    const width = page.width > 0 ? page.width : frame.width
    const height = page.height > 0 ? page.height : frame.height
    const id = pageObj(i)

    open(id)
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> /ProcSet [/PDF /ImageC /ImageB] >> /Contents ${id + 1} 0 R >>\nendobj\n`
    )

    // The image drawn across the whole page.
    const content = `q\n${num(width)} 0 0 ${num(height)} 0 0 cm\n/Im0 Do\nQ\n`
    open(id + 1)
    push(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream\nendobj\n`
    )

    open(id + 2)
    push(
      `<< /Type /XObject /Subtype /Image /Width ${frame.width} /Height ${frame.height} /ColorSpace ${colour} /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
    )
    push(page.jpeg)
    push('\nendstream\nendobj\n')
  })

  open(infoObj)
  push(
    `<< ${meta.title?.trim() ? `/Title ${pdfString(meta.title.trim())} ` : ''}/Producer (TDC AI) >>\nendobj\n`
  )

  // Every entry exactly 20 bytes, as the format requires.
  const xrefAt = length
  const size = infoObj + 1
  const entries = ['0000000000 65535 f \n']
  for (let id = 1; id < size; id++) {
    entries.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  }
  push(`xref\n0 ${size}\n${entries.join('')}`)
  push(
    `trailer\n<< /Size ${size} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  )

  return Buffer.concat(chunks)
}
