'use client'

import { PageHeader } from '@/components/page-header'
import { blogViewKey } from '@/lib/blogs/types'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import type { BlogEditorBlog, BlogLabels } from '../blogs-data'
import { BlogEditor } from './blog-editor'
import { BlogProgress } from './blog-progress'

/** The back link every blog page shows before its title. */
export function BackToBlogs() {
  return (
    <Link
      href="/blogs"
      aria-label="Back to Blogs & Articles"
      className="text-muted hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-lg"
    >
      <ArrowLeft className="h-4 w-4" />
    </Link>
  )
}

/**
 * A blog's page: its progress while it is first written (or why that
 * failed), then the editor.
 */
export function BlogView({
  initial,
  labels
}: {
  initial: BlogEditorBlog
  labels: BlogLabels
}) {
  const router = useRouter()
  const refresh = useCallback(() => router.refresh(), [router])
  const firstWriting =
    initial.wordCount === 0 &&
    (initial.generationStatus === 'generating' ||
      initial.generationStatus === 'failed')

  if (firstWriting) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        <PageHeader
          preTitle={<BackToBlogs />}
          title={initial.brief.topic}
          description="Being written"
        />
        <div className="bg-background flex-1 overflow-y-auto p-4 sm:p-6">
          <BlogProgress
            blogId={initial.id}
            brief={initial.brief}
            initial={{
              status: initial.generationStatus,
              stage: initial.generationStage,
              error: initial.generationError,
              stale: initial.stale
            }}
            startedAt={initial.generationStartedAt}
            onReady={refresh}
          />
        </div>
      </div>
    )
  }

  // Keyed by the version it shows and the run it is in: a finished, failed
  // or stopped run (refreshed from the server) opens the editor afresh.
  return (
    <BlogEditor key={blogViewKey(initial)} initial={initial} labels={labels} />
  )
}
