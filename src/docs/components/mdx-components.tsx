import {
  Card,
  Details,
  Grid,
  Kbd,
  NextSteps,
  Tags,
  textOf
} from '@/docs/components/mdx-blocks'
import {
  DocsHero,
  Eyebrow,
  Guide,
  Screenshot
} from '@/docs/components/mdx-visuals'
import { TabItem, Tabs } from '@/docs/components/tabs'
import { headingId } from '@/docs/sections'
import { ExternalLink } from 'lucide-react'
import type { MDXComponents } from 'mdx/types'
import Link from 'next/link'
import type { ComponentPropsWithoutRef } from 'react'

/**
 * How the help pages' markdown renders (required by @next/mdx; only the
 * pages under src/docs/content are MDX). Headings get the anchors the
 * "On this page" list and search link to, from the same headingId.
 */
const components = {
  h1: ({ children }) => (
    <h1 className="text-foreground mb-4 text-3xl font-bold tracking-tight text-balance sm:text-[2.1rem]">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      id={headingId(textOf(children))}
      className="text-foreground mt-12 mb-4 scroll-mt-24 text-2xl font-semibold tracking-tight"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      id={headingId(textOf(children))}
      className="text-foreground mt-8 mb-3 scroll-mt-24 text-xl font-semibold tracking-tight"
    >
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4
      id={headingId(textOf(children))}
      className="text-foreground mt-6 mb-2 scroll-mt-24 text-base font-semibold"
    >
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="text-foreground/90 my-4 text-[15.5px] leading-7">
      {children}
    </p>
  ),
  a: ({ href = '', children }: ComponentPropsWithoutRef<'a'>) => {
    const className =
      'text-brand-strong decoration-brand/40 hover:decoration-brand font-medium underline underline-offset-4 transition-colors'
    if (/^https?:\/\//.test(href) || href.startsWith('mailto:')) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={className}
        >
          {children}
          <ExternalLink
            aria-label="(opens in a new tab)"
            className="ml-0.5 inline h-3.5 w-3.5 align-[-2px]"
          />
        </a>
      )
    }
    if (href.startsWith('#'))
      return (
        <a href={href} className={className}>
          {children}
        </a>
      )
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    )
  },
  ul: ({ children }) => (
    <ul className="text-foreground/90 marker:text-muted my-4 list-disc space-y-1.5 pl-6 text-[15.5px] leading-7 [&_ol]:my-1.5 [&_ul]:my-1.5">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="text-foreground/90 marker:text-muted my-4 list-decimal space-y-1.5 pl-6 text-[15.5px] leading-7 [&_ol]:my-1.5 [&_ul]:my-1.5">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1 [&>p]:my-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-border text-muted my-6 border-l-4 pl-4 italic">
      {children}
    </blockquote>
  ),
  strong: ({ children }) => (
    <strong className="text-foreground font-semibold">{children}</strong>
  ),
  code: ({ children }) => (
    <code className="border-border bg-surface text-foreground rounded-md border px-1.5 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="border-border bg-surface my-6 overflow-x-auto rounded-xl border p-4 text-sm leading-6 [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="border-border my-6 overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface">{children}</thead>,
  tr: ({ children }) => (
    <tr className="border-border border-b last:border-b-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="text-foreground px-4 py-2.5 font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="text-foreground/90 px-4 py-2.5 align-top leading-6">
      {children}
    </td>
  ),
  hr: () => <hr className="border-border my-10" />,
  img: ({ src, alt }: ComponentPropsWithoutRef<'img'>) => (
    // Screenshots in the docs are plain files; their sizes are not known
    // up front, so next/image is not used.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={typeof src === 'string' ? src : undefined}
      alt={alt ?? ''}
      loading="lazy"
      className="border-border mx-auto my-8 block h-auto max-w-full rounded-xl border shadow-sm"
    />
  ),
  Tags,
  NextSteps,
  Grid,
  Card,
  Details,
  Tabs,
  TabItem,
  Kbd,
  DocsHero,
  Eyebrow,
  Guide,
  Screenshot
} satisfies MDXComponents

export function useMDXComponents(): MDXComponents {
  return components
}
