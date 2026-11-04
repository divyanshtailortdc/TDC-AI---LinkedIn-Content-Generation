import {
  textAroundLink,
  withoutMarkers,
  type EmailContent
} from '../../../intel/email-content'
import { MAX_DIGEST_ITEMS, type NewsletterDigest } from './schema'

/**
 * Used when no model is configured or its answer was unusable: each link
 * becomes a story, named by its own words or the line it is on, with the
 * email's text around it as the blurb. An email without links has none.
 */
export function digestHeuristically(content: EmailContent): NewsletterDigest {
  const text = withoutMarkers(content.text).replace(/\s+/g, ' ').trim()
  const summary = text
    .split(/(?<=[.?!])\s+/)
    .slice(0, 2)
    .join(' ')
    .slice(0, 600)

  const items = content.links.slice(0, MAX_DIGEST_ITEMS).map(link => {
    const around = textAroundLink(content.text, link.n)
    const named = link.text.split(/\s+/).filter(Boolean).length >= 3
    const headline = (named ? link.text : (around ?? link.text)).slice(0, 300)
    return {
      headline,
      blurb: around && around !== headline ? around : null,
      link: link.n,
      sponsored: false
    }
  })

  return {
    kind: items.length > 0 ? 'newsletter' : 'other',
    summary,
    topics: [],
    items: items.filter(item => item.headline.trim())
  }
}
