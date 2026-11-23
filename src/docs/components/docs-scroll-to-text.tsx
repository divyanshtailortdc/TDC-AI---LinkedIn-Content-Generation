'use client'

import {
  DOCS_FIND_EVENT,
  type DocsFindDetail
} from '@/docs/components/docs-search'
import { useEffect } from 'react'

const BLOCKS = 'p, li, td, th, h2, h3, h4, summary, blockquote, pre'

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * The element on the page that shows `text` (a search snippet): the
 * smallest block containing all of it, else the one sharing most of its
 * words.
 */
function findText(container: HTMLElement, text: string): HTMLElement | null {
  const needle = normalize(text)
  if (!needle) return null
  const words = needle.split(' ').filter(word => word.length > 2)
  let best: { element: HTMLElement; score: number } | null = null
  for (const element of container.querySelectorAll<HTMLElement>(BLOCKS)) {
    const haystack = normalize(element.textContent ?? '')
    if (!haystack) continue
    let score: number
    if (haystack.includes(needle)) {
      // Whole match; a smaller element is a closer one.
      score = 2 + 1 / haystack.length
    } else {
      if (words.length === 0) continue
      const found = words.filter(word => haystack.includes(word)).length
      score = found / words.length
      if (score < 0.6) continue
    }
    if (!best || score > best.score) best = { element, score }
  }
  return best?.element ?? null
}

function reveal(element: HTMLElement) {
  // Inside a folded question: open it first.
  for (
    let details = element.closest('details');
    details;
    details = details.parentElement?.closest('details') ?? null
  )
    details.open = true
  element.scrollIntoView({ block: 'center' })
  element.classList.remove('docs-search-hit')
  // Restart the highlight if the same element is found twice in a row.
  void element.offsetWidth
  element.classList.add('docs-search-hit')
  element.addEventListener(
    'animationend',
    () => element.classList.remove('docs-search-hit'),
    { once: true }
  )
}

/**
 * Opening a search result's passage: scrolls to its text on this page and
 * highlights it briefly, as potential-adventure's docs do. The passage
 * comes in the address (#search&text=…&section=…) when the result was on
 * another page, or as an event when it was on this one.
 */
export function DocsScrollToText({ slug }: { slug: string }) {
  useEffect(() => {
    const find = ({ text, section }: Omit<DocsFindDetail, 'slug'>) => {
      const container = document.querySelector<HTMLElement>(
        '[data-docs-content]'
      )
      if (!container) return
      const target =
        findText(container, text) ??
        (section ? document.getElementById(section) : null)
      if (target) reveal(target)
      // Leave a clean address: the heading's anchor, if there is one.
      const { pathname, search } = window.location
      window.history.replaceState(
        null,
        '',
        `${pathname}${search}${section ? `#${section}` : ''}`
      )
    }

    // After the page and the router's own scrolling have settled.
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.hash.slice(1))
      const text = params.get('text')
      if (params.has('search') && text)
        find({ text, section: params.get('section') ?? undefined })
    }, 120)

    const onFind = (event: Event) => {
      const { detail } = event as CustomEvent<DocsFindDetail>
      if (detail.slug === slug) window.setTimeout(() => find(detail), 120)
    }
    window.addEventListener(DOCS_FIND_EVENT, onFind)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener(DOCS_FIND_EVENT, onFind)
    }
  }, [slug])

  return null
}
