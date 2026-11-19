import {
  DocsBreadcrumbs,
  DocsPagination
} from '@/docs/components/docs-page-parts'
import { DocsScrollToText } from '@/docs/components/docs-scroll-to-text'
import { DocsToc } from '@/docs/components/docs-toc'
import { NextSteps } from '@/docs/components/mdx-blocks'
import { loadDoc } from '@/docs/content'
import { DOC_PAGES } from '@/docs/nav'
import { tableOfContents } from '@/docs/sections'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ComponentProps } from 'react'

type Props = { params: Promise<{ slug?: string[] }> }

function slugOf(parts: string[] | undefined) {
  return (parts ?? []).map(decodeURIComponent).join('/')
}

export function generateStaticParams() {
  return DOC_PAGES.map(page => ({
    slug: page.slug ? page.slug.split('/') : []
  }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const doc = await loadDoc(slugOf((await params).slug))
  if (!doc) return { title: 'Not found · Docs · TDC Content Engine' }
  return {
    title: doc.page.slug
      ? `${doc.page.title} · Docs · TDC Content Engine`
      : 'Documentation · TDC Content Engine',
    description: doc.page.description
  }
}

export default async function DocPage({ params }: Props) {
  const slug = slugOf((await params).slug)
  const doc = await loadDoc(slug)
  if (!doc) notFound()

  const { page, Content, parsed } = doc
  const headings = tableOfContents(parsed)
  // Next steps without links of their own list this page's neighbours.
  const components = {
    NextSteps: (props: ComponentProps<typeof NextSteps>) => (
      <NextSteps {...props} slug={slug} />
    )
  }

  return (
    <div className="flex gap-10 px-4 py-8 sm:px-8 lg:py-10 xl:gap-12">
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-3xl">
          <DocsBreadcrumbs page={page} />
          <article data-docs-content>
            <Content components={components} />
          </article>
          <DocsPagination slug={slug} />
        </div>
      </div>
      {headings.length > 0 && (
        <aside className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pb-6">
            <DocsToc headings={headings} />
          </div>
        </aside>
      )}
      <DocsScrollToText slug={slug} />
    </div>
  )
}
