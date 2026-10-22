import * as cheerio from 'cheerio'
import { findLinks, normalizeUrlForCompare } from './urls'

/**
 * The links a page offers its visitors (its menus, product cards and footer),
 * each with the words the page uses for it. Read from the page's HTML, because
 * a page reader shows what is on screen: a menu that only opens on a click is
 * not there, and many sites (Next.js ones among them) send such a menu as data
 * in a script rather than as links in the page. So a business's product menu
 * could list products that no reading of its homepage ever saw.
 *
 * This only reads the page's structure. What each link is (a product, a
 * partner, a login page) is for the reader, the AI, to judge.
 */

export type SiteLink = {
  /**
   * As the page writes it; a relative link is resolved against the page, as
   * a browser does.
   */
  url: string
  /** The page's own words for the link. */
  label: string
  /** The line a menu or card gives under the label, when it has one. */
  description?: string
}

/** Past this, a page's links stop telling the reader much. */
const MAX_LINKS = 60
const MAX_LABEL_CHARS = 120
const MAX_DESCRIPTION_CHARS = 200

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * An http(s) address for `href` as the page means it, or null. One written
 * in full is kept exactly as written.
 */
function resolveHref(href: string, pageUrl: string): string | null {
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  try {
    const url = new URL(trimmed, pageUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return /^https?:\/\//i.test(trimmed) ? trimmed : url.toString()
  } catch {
    return null
  }
}

type DomNode = { type: string; data?: string; children?: DomNode[] }

/** An element's text with a space between its parts: "CRM One record", not "CRMOne record". */
function textOf(node: DomNode): string {
  if (node.type === 'text') return node.data ?? ''
  return (node.children ?? []).map(textOf).join(' ')
}

/** Collects links in the order found, each once; a later sighting may add a description. */
function linkCollector(pageUrl: string) {
  const own = normalizeUrlForCompare(pageUrl)
  const found = new Map<string, SiteLink>()
  return {
    add(href: string, label: string, description?: string) {
      const url = resolveHref(href, pageUrl)
      const name = oneLine(label).slice(0, MAX_LABEL_CHARS)
      if (!url || !name) return
      const key = normalizeUrlForCompare(url)
      // The logo and "back to top" lead to the page itself.
      if (key === own) return
      const about = description
        ? oneLine(description).slice(0, MAX_DESCRIPTION_CHARS)
        : ''
      const seen = found.get(key)
      if (seen) {
        // The same item met again, say a card and its menu entry, may add its
        // description; another item linking there (a "Support" card leading
        // to the CRM page) must not lend it its own.
        const a = seen.label.toLowerCase()
        const b = name.toLowerCase()
        if (
          !seen.description &&
          about &&
          (a.startsWith(b) || b.startsWith(a)) &&
          !a.includes(about.toLowerCase())
        ) {
          seen.description = about
        }
        return
      }
      found.set(key, {
        url,
        label: name,
        ...(about && about !== name ? { description: about } : {})
      })
    },
    links: () => [...found.values()]
  }
}

/** Keys that hold a menu item's link, and its label, in a site's page data. */
const LINK_KEYS = ['href', 'url'] as const
const LABEL_KEYS = ['title', 'label', 'name', 'text'] as const

/** A JSON string inside a script; Next.js streams its page data this way. */
const STRING_LITERAL = /"((?:[^"\\]|\\.)*)"/g
/** An object with no other object inside it, as a menu item usually is. */
const FLAT_OBJECT = /\{[^{}]*\}/g

/** The script's text, and any JSON it carries inside a string, decoded. */
function scriptTexts(script: string): string[] {
  const texts = [script]
  for (const match of script.matchAll(STRING_LITERAL)) {
    if (!match[1]!.includes('\\"')) continue
    try {
      texts.push(JSON.parse(`"${match[1]}"`) as string)
    } catch {
      // Not JSON after all.
    }
  }
  return texts
}

/** Menu items held as data: objects with a link and a label. */
function dataLinks(
  text: string
): Array<{ href: string; label: string; description?: string }> {
  const items: Array<{ href: string; label: string; description?: string }> = []
  for (const match of text.matchAll(FLAT_OBJECT)) {
    let value: unknown
    try {
      value = JSON.parse(match[0])
    } catch {
      continue
    }
    if (!value || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    const pick = (keys: readonly string[]) =>
      keys
        .map(key => item[key])
        .find((v): v is string => typeof v === 'string' && v.trim() !== '')
    const href = pick(LINK_KEYS)
    const label = pick(LABEL_KEYS)
    if (!href || !label) continue
    items.push({
      href,
      label,
      description:
        typeof item.description === 'string' ? item.description : undefined
    })
  }
  return items
}

/**
 * Every link a page's HTML offers: the links in the page, then the ones its
 * scripts hold as data (a menu that opens on a click). `pageUrl` is the
 * address the HTML was served from, for resolving relative links.
 */
export function extractSiteLinks(html: string, pageUrl: string): SiteLink[] {
  const $ = cheerio.load(html)
  const collect = linkCollector(pageUrl)

  $('a[href]').each((_, el) => {
    const anchor = $(el)
    const label =
      oneLine(textOf(el as DomNode)) ||
      anchor.attr('aria-label') ||
      anchor.attr('title') ||
      anchor.find('img[alt]').first().attr('alt') ||
      ''
    collect.add(anchor.attr('href') ?? '', label)
  })

  $('script:not([src])').each((_, el) => {
    for (const text of scriptTexts($(el).text())) {
      for (const item of dataLinks(text)) {
        collect.add(item.href, item.label, item.description)
      }
    }
  })

  return collect.links().slice(0, MAX_LINKS)
}

/** A markdown link: "[label](https://…)". */
const MARKDOWN_LINK = /\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g

/**
 * The links in a page as a reader wrote it out in markdown, for when its HTML
 * could not be fetched.
 */
export function markdownLinks(markdown: string, pageUrl: string): SiteLink[] {
  const collect = linkCollector(pageUrl)
  for (const match of markdown.matchAll(MARKDOWN_LINK)) {
    collect.add(match[2]!, match[1]!)
  }
  return collect.links().slice(0, MAX_LINKS)
}

/**
 * A page's text with the links it does not show, such as a menu that opens
 * on a click, so the AI and the checks on its answer both read them as the
 * site's own words. They come first: after a long page they were passed over,
 * and a page cut to length never loses them.
 */
export function withUnseenLinks(
  text: string,
  links: SiteLink[],
  pageUrl: string
): string {
  const shown = new Set(
    [...markdownLinks(text, pageUrl), ...findLinks(text)].map(link =>
      normalizeUrlForCompare(link.url)
    )
  )
  const unseen = links.filter(
    link => !shown.has(normalizeUrlForCompare(link.url))
  )
  return unseen.length > 0 ? `${formatSiteLinks(unseen)}\n\n${text}` : text
}

/** The links as lines the AI reads with the page: "- Label: description (url)". */
export function formatSiteLinks(links: SiteLink[]): string {
  return [
    "Links on this page, from its menus, product cards and page data, in the page's own words:",
    ...links.map(
      link =>
        `- ${link.label}${link.description ? `: ${link.description}` : ''} (${link.url})`
    )
  ].join('\n')
}
