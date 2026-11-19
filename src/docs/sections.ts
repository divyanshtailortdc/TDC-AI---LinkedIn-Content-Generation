/**
 * A help page's MDX read as plain text and split at its headings: the
 * page's "On this page" list, docs search and the search embeddings all
 * come from here, so they agree on where each heading's anchor is.
 *
 * Plain functions with no Node or browser APIs: the docs route, the search
 * modal, src/docs/scripts/build-search-index.ts and the tests all use them.
 */

/** A heading's anchor; the MDX heading components use it too. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export type DocSection = {
  /** Its heading's anchor; '' for the text before the first heading. */
  id: string
  heading: string
  /** 2 or 3 for a heading; 1 for the text before the first. */
  level: 1 | 2 | 3
  /** Plain text, one paragraph, list item or table row per line. */
  text: string
}

export type ParsedDoc = {
  /** The page's own heading (its first `#`), '' if it has none. */
  title: string
  sections: DocSection[]
}

/** Attributes whose text a reader sees: a Details summary, a tab's label. */
const VISIBLE_ATTRIBUTES = ['summary', 'label', 'title']

/** The index after a JSX tag that starts at `start`, or -1 if it never closes. */
function tagEnd(source: string, start: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i]
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') quote = char
    else if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === '>' && depth === 0) return i + 1
  }
  return -1
}

/**
 * JSX tags taken out, their text kept. A self-closing component (Next steps,
 * a card) is dropped whole: what it shows is another page's title. An
 * opening tag leaves the text of its visible attributes.
 */
function stripJsx(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const char = source[i]
    const next = source[i + 1] ?? ''
    if (char === '<' && /[A-Za-z/]/.test(next)) {
      const end = tagEnd(source, i)
      if (end !== -1) {
        const tag = source.slice(i, end)
        const selfClosing = /\/\s*>$/.test(tag)
        if (!selfClosing && !tag.startsWith('</')) {
          for (const name of VISIBLE_ATTRIBUTES) {
            const match = tag.match(
              new RegExp(
                `\\s${name}=(?:"([^"]*)"|'([^']*)'|\\{["'\`]([^"'\`]*)["'\`]\\})`
              )
            )
            const value = match?.[1] ?? match?.[2] ?? match?.[3]
            if (value) out += `\n${value}\n`
          }
        }
        out += '\n'
        i = end
        continue
      }
    }
    out += char
    i++
  }
  return out
}

/** Markdown inline syntax taken out of one line. */
export function plainInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '$1')
    .replace(/(?<![\w])_(?!\s)(.+?)(?<!\s)_(?![\w])/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!>|])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/
const THEMATIC_BREAK = /^\s*([-*_])(?:\s*\1){2,}\s*$/

export function parseDoc(source: string): ParsedDoc {
  const withoutComments = source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // ESM: imports, and exports such as `export const metadata`.
    .replace(/^(?:import|export)\s[^\n]*(?:\n(?!\s*\n)[^\n]*)*/gm, '')

  let title = ''
  const sections: DocSection[] = [{ id: '', heading: '', level: 1, text: '' }]
  const blocks: string[][] = [[]]
  let inFence = false
  let continuing = false

  const current = () => blocks[blocks.length - 1]!
  /**
   * A block of its own (a list item, a table row), or `paragraph` text,
   * which joins the line before when that was text too. A blank line ends
   * the block either way.
   */
  const addBlock = (text: string, kind: 'block' | 'paragraph') => {
    const lines = current()
    if (!text) {
      continuing = false
      return
    }
    if (kind === 'paragraph' && continuing && lines.length > 0) {
      lines[lines.length - 1] += ` ${text}`
    } else {
      lines.push(text)
    }
    continuing = kind === 'paragraph'
  }

  // Code blocks are kept as they are: no tags or markdown to take out.
  const parts = withoutComments.split(/^(\s*(?:```|~~~)[^\n]*)$/m)
  const lines: Array<{ text: string; code: boolean }> = []
  for (const part of parts) {
    if (/^\s*(?:```|~~~)/.test(part)) {
      inFence = !inFence
      continue
    }
    const text = inFence ? part : stripJsx(part)
    for (const line of text.split('\n'))
      lines.push({ text: line, code: inFence })
  }

  for (const { text: line, code } of lines) {
    if (code) {
      addBlock(line.trim(), 'block')
      continuing = false
      continue
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      const level = heading[1]!.length
      const text = plainInline(heading[2]!)
      continuing = false
      if (level === 1) {
        if (!title) title = text
        continue
      }
      if (level === 2 || level === 3) {
        sections.push({ id: headingId(text), heading: text, level, text: '' })
        blocks.push([])
        continue
      }
      addBlock(text, 'block')
      continuing = false
      continue
    }
    if (TABLE_RULE.test(line) || THEMATIC_BREAK.test(line)) {
      continuing = false
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map(cell => plainInline(cell))
        .filter(Boolean)
      addBlock(cells.join(' — '), 'block')
      continuing = false
      continue
    }
    const quoted = line.replace(/^\s*>\s?/, '')
    if (LIST_ITEM.test(quoted)) {
      // Its own block; a lazy continuation line on the next line joins it.
      addBlock(plainInline(quoted.replace(LIST_ITEM, '')), 'block')
      continuing = true
      continue
    }
    addBlock(plainInline(quoted), 'paragraph')
  }

  sections.forEach((section, index) => {
    section.text = (blocks[index] ?? []).join('\n')
  })
  sections[0]!.heading = title
  return {
    title,
    sections: sections.filter(
      (section, index) => index > 0 || section.text.length > 0
    )
  }
}

/** The headings for a page's "On this page" list. */
export function tableOfContents(
  doc: ParsedDoc
): Array<{ id: string; heading: string; level: 2 | 3 }> {
  return doc.sections.flatMap(section =>
    section.level === 2 || section.level === 3
      ? [{ id: section.id, heading: section.heading, level: section.level }]
      : []
  )
}
