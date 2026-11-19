import { DOCS_PATH } from '@/docs/nav'
import { FileQuestion } from 'lucide-react'
import Link from 'next/link'

/** A /docs address with no page behind it. */
export default function DocsNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <div className="bg-brand/12 text-brand-strong mb-5 flex h-12 w-12 items-center justify-center rounded-2xl">
        <FileQuestion aria-hidden className="h-6 w-6" />
      </div>
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">
        This page does not exist
      </h1>
      <p className="text-muted mt-2 text-[15px]">
        It may have moved. Search the docs, or start from the beginning.
      </p>
      <Link
        href={DOCS_PATH}
        className="bg-accent text-background hover:bg-accent-hover mt-6 inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold transition-colors"
      >
        Back to documentation home
      </Link>
    </div>
  )
}
