import {
  isSiteRoot,
  normalizeUrlForCompare,
  toWebUrl,
  type FoundLink
} from '@/lib/urls'
import type { VerifiedLink } from './research'
import { PROVIDED_SOURCE, type Suggested } from './schema'

/**
 * The Website URL suggestion. The AI decides what each linked page is and
 * whether a site is the identity's own, from the words around each link; this
 * only checks that its choice is grounded and says plainly what it is:
 *
 * - A link typed into the form is the user's own value and always wins.
 * - The AI's choice stands as a fact when it is a site root the user wrote or
 *   research verified, kept exactly as written there.
 * - The root of the same host as a page the user linked (www.shopify.com for
 *   www.shopify.com/careers) is the AI's recommendation, with a note naming
 *   the link it came from. A different host is never worked out from a link:
 *   www.samsung.com is not taken from news.samsung.com unless research
 *   verified it, since that would be guessing at a domain.
 * - A specific page is kept only as a recommendation with a note saying so,
 *   so it is never taken for the homepage without the user seeing that.
 *   Whether a host is the main site or a newsroom is the AI's judgment, made
 *   from the words around the link.
 * - Anything else was invented or altered and is dropped.
 */

export type LinkSuggestion = Suggested<string>

const WEBSITE = 'Profile → Website URL'

const sameUrl = (a: string, b: string) =>
  normalizeUrlForCompare(a) === normalizeUrlForCompare(b)

/** Exactly the same host: news.samsung.com is not www.samsung.com, nor is samsung.com. */
const sameHost = (a: string, b: string) =>
  new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase()

const hostname = (url: string) => new URL(url).hostname.toLowerCase()

const provided = (url: string): LinkSuggestion => ({
  value: url,
  kind: 'fact',
  source: PROVIDED_SOURCE,
  confidence: 'high'
})

/** A link research verified is sourced to itself, so the review shows where it came from. */
const verifiedFact = (link: VerifiedLink): LinkSuggestion => ({
  value: link.url,
  kind: 'fact',
  source: link.url,
  confidence: link.confidence
})

/** Long links are cut in notes; the review shows the value in full. */
const shown = (url: string) =>
  url.length > 200 ? `${url.slice(0, 200)}…` : url

export function chooseWebsite(input: {
  /** What the model put in websiteUrl, as it wrote it. */
  proposed?: string
  /** The Website URL typed into the form. */
  typed?: string
  /** Links written in the description. */
  mentioned: FoundLink[]
  verified?: VerifiedLink
}): { website?: LinkSuggestion; warnings: string[] } {
  const warnings: string[] = []
  const { verified } = input
  const proposed = input.proposed ? toWebUrl(input.proposed) : null

  let choice: LinkSuggestion | undefined
  if (input.proposed && !proposed) {
    warnings.push(`${WEBSITE}: dropped a value that is not a web address.`)
  } else if (proposed) {
    const written = input.mentioned.find(link => sameUrl(link.url, proposed))
    const sameSite = input.mentioned.find(link => sameHost(link.url, proposed))
    if (/(^|\.)linkedin\.com$/.test(hostname(proposed))) {
      warnings.push(
        `${WEBSITE}: dropped a link that is a LinkedIn page, not a website.`
      )
    } else if (verified && sameUrl(proposed, verified.url)) {
      choice = verifiedFact(verified)
    } else if (written && isSiteRoot(written.url)) {
      choice = provided(written.url)
    } else if (written) {
      choice = {
        value: written.url,
        kind: 'recommendation',
        confidence: 'medium',
        note: `This is a page from your details, not a homepage. Its site's homepage is ${written.homepage}. Check which one you want.`
      }
    } else if (sameSite && isSiteRoot(proposed)) {
      choice = {
        value: sameSite.homepage,
        kind: 'recommendation',
        confidence: 'medium',
        note: `The homepage of the site you linked (${shown(sameSite.url)}). Check it before applying.`
      }
    } else {
      warnings.push(
        `${WEBSITE}: dropped a URL that was neither provided by you nor verified.`
      )
    }
  }

  // A newsroom or careers subdomain is a section of a site, not the main
  // website. The AI is told so; if it still picked one, the review says so.
  // Whatever page it is, a link typed into the field is the user's own value.
  if (input.typed) return { website: provided(input.typed), warnings }
  if (choice) return { website: choice, warnings }
  if (verified) return { website: verifiedFact(verified), warnings }
  return { warnings }
}
