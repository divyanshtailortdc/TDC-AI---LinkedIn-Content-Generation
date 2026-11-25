'use server'

import { db } from '@/db'
import { audiencesTable, goalsTable, ideasTable, type Blog } from '@/db/schema'
import { isAICapable } from '@/lib/ai'
import {
  claimBlogGeneration,
  createClaimedBlog,
  type BlogClaim
} from '@/lib/blogs/claim'
import { blogWordCount } from '@/lib/blogs/doc'
import {
  parseCreateInput,
  parseInstruction,
  parsePublishInput,
  parseSaveInput
} from '@/lib/blogs/input'
import { findBlogRevision, listBlogRevisions } from '@/lib/blogs/revisions'
import { makeFeaturedImage } from '@/lib/blogs/featured-image'
import { FEATURED_IMAGE_DEPS } from '@/lib/blogs/featured-image-deps'
import {
  deleteIdentityBlog,
  findIdentityBlog,
  restoreBlogRevision,
  saveBlogEdit,
  setBlogPublished as setPublished,
  setFeaturedImage
} from '@/lib/blogs/store'
import {
  isGenerationStale,
  type BlogContent,
  type BlogGenerationStage,
  type BlogGenerationStatus,
  type BlogReplacedBy,
  type BlogSnapshot
} from '@/lib/blogs/types'
import { DEFAULT_BRAND_THEME } from '@/lib/brand/theme'
import { deleteBlogImages, loadImageDataUrl } from '@/lib/media/image-store'
import { requireIdentityId } from '@/lib/identity'
import { requireUser } from '@/lib/session'
import { and, eq } from 'drizzle-orm'
import { after } from 'next/server'
import { loadBrandTheme, loadGenerationContext } from '~/lib/ai/context'
import {
  blogChecksFor,
  blogContentOf,
  checkBlogSourcesNow,
  featuredImageView,
  rewriteBlogSectionNow,
  runBlogGeneration
} from '~/lib/ai/pipeline/blog-run'
import { withAiSpend } from '~/lib/ai/spend'
import { editorBlogOf, type BlogEditorBlog } from './blogs-data'

/**
 * The actions behind the Blogs & Articles pages. Each takes the signed-in
 * user from the session and acts only on the active identity's blogs: any
 * other blog is "not found". Generations run after the response (`after`),
 * charged to the identity under 'blogs'; the page follows them with
 * fetchBlogStatus.
 */

type Failure = { success: false; error: string }

const NOT_AI = 'AI is not set up: add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY.'
const NOT_FOUND =
  'This blog was not found. It may have been deleted, or belong to another identity.'
const GENERATING =
  'This blog is being written. Wait for it to finish, then try again.'
const CONFLICT =
  'This blog changed in another tab or by a regeneration. Reload to see it.'

const fail = (error: unknown, fallback: string): Failure => ({
  success: false,
  error: error instanceof Error && error.message ? error.message : fallback
})

const reasonError = (reason: string) =>
  reason === 'generating'
    ? GENERATING
    : reason === 'conflict'
      ? CONFLICT
      : reason === 'version_not_found'
        ? 'That version no longer exists.'
        : NOT_FOUND

/** Writes the claimed generation after the response, kept alive until it ends. */
function startGeneration(
  accountId: string,
  claim: BlogClaim,
  options: {
    instruction?: string | null
    researchAgain?: boolean
    newImage?: boolean
  } = {}
) {
  after(() =>
    withAiSpend({ source: 'blogs', accountId }, () =>
      runBlogGeneration(claim, options)
    ).catch(err =>
      console.error(`Blog ${claim.blogId} generation failed:`, err)
    )
  )
}

/** Checks a version of the blog's text against the identity's settings. */
async function checkerFor(blog: Blog) {
  const ctx = await loadGenerationContext(blog.accountId, {
    goalIds: blog.goalId ? [blog.goalId] : [],
    lintOnly: true
  })
  const brief = { ...blog.brief, caseDetails: blog.brief.caseDetails ?? '' }
  return (text: BlogContent) => blogChecksFor(ctx, text, brief)
}

/** An earlier version as the checks read it: its image as the page shows it. */
const snapshotContent = (blog: Blog, snapshot: BlogSnapshot): BlogContent => ({
  ...blogContentOf(blog),
  ...snapshot,
  searchIntent: snapshot.searchIntent ?? blog.searchIntent ?? '',
  featuredImage:
    snapshot.featuredImage === undefined
      ? featuredImageView(blog.featuredImage)
      : featuredImageView(snapshot.featuredImage),
  verification: blog.verification ?? null
})

/** Starts a blog from the New blog form; answers with its id at once. */
export async function createBlog(
  raw: unknown
): Promise<{ success: true; id: string } | Failure> {
  await requireUser()
  try {
    const parsed = parseCreateInput(raw)
    if (!parsed.ok) return { success: false, error: parsed.error }
    if (!isAICapable) return { success: false, error: NOT_AI }
    const accountId = await requireIdentityId()
    const { requestId, kind, ideaId, goalId, brief } = parsed.value

    if (ideaId) {
      const [idea] = await db
        .select({ id: ideasTable.id })
        .from(ideasTable)
        .where(
          and(eq(ideasTable.id, ideaId), eq(ideasTable.accountId, accountId))
        )
        .limit(1)
      if (!idea) return { success: false, error: 'That idea was not found.' }
    }
    if (goalId) {
      const [goal] = await db
        .select({ id: goalsTable.id })
        .from(goalsTable)
        .where(
          and(eq(goalsTable.id, goalId), eq(goalsTable.accountId, accountId))
        )
        .limit(1)
      if (!goal) return { success: false, error: 'That goal was not found.' }
    }
    const audienceId = brief.audience.audienceId
    if (audienceId) {
      const [audience] = await db
        .select({ id: audiencesTable.id })
        .from(audiencesTable)
        .where(
          and(
            eq(audiencesTable.id, audienceId),
            eq(audiencesTable.accountId, accountId)
          )
        )
        .limit(1)
      if (!audience)
        return { success: false, error: 'That audience was not found.' }
    }

    const created = await createClaimedBlog(db, {
      id: requestId,
      accountId,
      ideaId,
      goalId,
      kind,
      brief
    })
    if (created.outcome === 'taken') {
      return { success: false, error: 'Reload the page and try again.' }
    }
    if (created.outcome === 'exists')
      return { success: true, id: created.blogId }
    startGeneration(accountId, created.claim)
    return { success: true, id: created.claim.blogId }
  } catch (err) {
    return fail(err, 'The blog could not be started.')
  }
}

/** Where a generation stands, for a page following it. */
export async function fetchBlogStatus(blogId: string): Promise<
  | {
      success: true
      status: BlogGenerationStatus
      stage: BlogGenerationStage | null
      error: string | null
      stale: boolean
    }
  | Failure
> {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const blog = await findIdentityBlog(db, accountId, blogId)
    if (!blog) return { success: false, error: NOT_FOUND }
    return {
      success: true,
      status: blog.generationStatus,
      stage: blog.generationStage ?? null,
      error: blog.generationError,
      stale: isGenerationStale(blog)
    }
  } catch (err) {
    return fail(err, 'Could not check the blog.')
  }
}

/** Starts a failed or stopped generation again. */
export async function retryBlogGeneration(
  blogId: string
): Promise<{ success: true } | Failure> {
  await requireUser()
  try {
    if (!isAICapable) return { success: false, error: NOT_AI }
    const accountId = await requireIdentityId()
    const blog = await findIdentityBlog(db, accountId, blogId)
    if (!blog) return { success: false, error: NOT_FOUND }
    if (blog.generationStatus === 'ready') {
      return {
        success: false,
        error: 'This blog is written. Use Regenerate for a new version.'
      }
    }
    const claim = await claimBlogGeneration(db, { accountId, blogId: blog.id })
    if (!claim) return { success: false, error: GENERATING }
    startGeneration(accountId, claim)
    return { success: true }
  } catch (err) {
    return fail(err, 'The blog could not be started again.')
  }
}

/** Writes a new version of the whole blog, with what the user asked for. */
export async function regenerateBlog(
  blogId: string,
  raw: { instruction?: unknown; researchAgain?: unknown; newImage?: unknown }
): Promise<{ success: true } | Failure> {
  await requireUser()
  try {
    const parsed = parseInstruction(raw?.instruction)
    if (!parsed.ok) return { success: false, error: parsed.error }
    if (!isAICapable) return { success: false, error: NOT_AI }
    const accountId = await requireIdentityId()
    const claim = await claimBlogGeneration(db, { accountId, blogId })
    if (!claim) {
      const blog = await findIdentityBlog(db, accountId, blogId)
      return { success: false, error: blog ? GENERATING : NOT_FOUND }
    }
    startGeneration(accountId, claim, {
      instruction: parsed.instruction,
      researchAgain: raw?.researchAgain === true,
      newImage: raw?.newImage === true
    })
    return { success: true }
  } catch (err) {
    return fail(err, 'The new version could not be started.')
  }
}

export async function saveBlog(
  blogId: string,
  raw: unknown
): Promise<
  { success: true; blog: BlogEditorBlog } | (Failure & { conflict?: true })
> {
  await requireUser()
  try {
    const parsed = parseSaveInput(raw)
    if (!parsed.ok) return { success: false, error: parsed.error }
    const accountId = await requireIdentityId()
    const blog = await findIdentityBlog(db, accountId, blogId)
    if (!blog) return { success: false, error: NOT_FOUND }
    const { edit, lockVersion } = parsed
    const check = await checkerFor(blog)
    const image = featuredImageView(blog.featuredImage)
    const checks = check({
      ...blogContentOf(blog),
      ...edit,
      featuredImage: image
        ? { ...image, alt: edit.featuredAlt, caption: edit.featuredCaption }
        : null
    })
    const outcome = await saveBlogEdit(db, {
      accountId,
      blogId: blog.id,
      lockVersion,
      edit,
      wordCount: blogWordCount(edit.content, edit.faq),
      checks
    })
    if (!outcome.ok) {
      return outcome.reason === 'conflict'
        ? { success: false, error: CONFLICT, conflict: true }
        : { success: false, error: reasonError(outcome.reason) }
    }
    return { success: true, blog: await editorBlogOf(outcome.blog) }
  } catch (err) {
    return fail(err, 'The blog could not be saved.')
  }
}

/** Writes one section again while the user waits. */
export async function rewriteBlogSection(
  blogId: string,
  raw: { sectionIndex?: unknown; instruction?: unknown; lockVersion?: unknown }
): Promise<
  { success: true; blog: BlogEditorBlog } | (Failure & { conflict?: true })
> {
  await requireUser()
  try {
    const parsed = parseInstruction(raw?.instruction)
    if (!parsed.ok) return { success: false, error: parsed.error }
    const sectionIndex = Number(raw?.sectionIndex)
    const lockVersion = Number(raw?.lockVersion)
    if (!Number.isInteger(sectionIndex) || !Number.isInteger(lockVersion)) {
      return { success: false, error: 'Reload the page and try again.' }
    }
    if (!isAICapable) return { success: false, error: NOT_AI }
    const accountId = await requireIdentityId()
    const result = await withAiSpend({ source: 'blogs', accountId }, () =>
      rewriteBlogSectionNow({
        accountId,
        blogId,
        sectionIndex,
        instruction: parsed.instruction,
        lockVersion
      })
    )
    if (!result.ok) {
      if ('error' in result) return { success: false, error: result.error }
      return result.reason === 'conflict'
        ? { success: false, error: CONFLICT, conflict: true }
        : { success: false, error: reasonError(result.reason) }
    }
    return { success: true, blog: await editorBlogOf(result.blog) }
  } catch (err) {
    return fail(err, 'The section could not be rewritten.')
  }
}

export type BlogVersionItem = {
  id: string
  number: number
  replacedBy: BlogReplacedBy
  instruction: string | null
  title: string
  wordCount: number
  createdAt: string
}

/** The blog's earlier versions, newest first, without their text. */
export async function loadBlogVersions(
  blogId: string
): Promise<{ success: true; versions: BlogVersionItem[] } | Failure> {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const blog = await findIdentityBlog(db, accountId, blogId)
    if (!blog) return { success: false, error: NOT_FOUND }
    const rows = await listBlogRevisions(db, blog.id)
    return {
      success: true,
      versions: rows.map(row => ({
        id: row.id,
        number: row.number,
        replacedBy: row.replacedBy,
        instruction: row.instruction,
        title: row.snapshot.title,
        wordCount: row.snapshot.wordCount,
        createdAt: row.createdAt.toISOString()
      }))
    }
  } catch (err) {
    return fail(err, 'Could not load earlier versions.')
  }
}

/** One earlier version's text, to preview before restoring it. */
export async function loadBlogVersion(
  blogId: string,
  revisionId: string
): Promise<{ success: true; snapshot: BlogSnapshot } | Failure> {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const blog = await findIdentityBlog(db, accountId, blogId)
    if (!blog) return { success: false, error: NOT_FOUND }
    const revision = await findBlogRevision(db, blog.id, revisionId)
    if (!revision)
      return { success: false, error: 'That version no longer exists.' }
    return { success: true, snapshot: revision.snapshot }
  } catch (err) {
    return fail(err, 'Could not load that version.')
  }
}

export async function restoreBlogVersion(
  blogId: string,
  revisionId: string
): Promise<{ success: true; blog: BlogEditorBlog } | Failure> {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const blog = await findIdentityBlog(db, accountId, blogId)
    if (!blog) return { success: false, error: NOT_FOUND }
    const check = await checkerFor(blog)
    const outcome = await restoreBlogRevision(db, {
      accountId,
      blogId: blog.id,
      revisionId,
      checksFor: snapshot => check(snapshotContent(blog, snapshot))
    })
    if (!outcome.ok)
      return { success: false, error: reasonError(outcome.reason) }
    return { success: true, blog: await editorBlogOf(outcome.blog) }
  } catch (err) {
    return fail(err, 'The version could not be restored.')
  }
}

/** Marks the blog published (with where, optionally) or back to a draft. */
export async function setBlogPublished(
  blogId: string,
  raw: unknown
): Promise<{ success: true; blog: BlogEditorBlog } | Failure> {
  await requireUser()
  try {
    const parsed = parsePublishInput(raw)
    if (!parsed.ok) return { success: false, error: parsed.error }
    const accountId = await requireIdentityId()
    const outcome = await setPublished(db, {
      accountId,
      blogId,
      published: parsed.published,
      url: parsed.url,
      destination: parsed.destination,
      publishedAt: parsed.publishedAt
    })
    if (!outcome.ok)
      return { success: false, error: reasonError(outcome.reason) }
    return { success: true, blog: await editorBlogOf(outcome.blog) }
  } catch (err) {
    return fail(err, 'Could not change whether it is published.')
  }
}

export async function deleteBlog(
  blogId: string
): Promise<{ success: true } | Failure> {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const deleted = await deleteIdentityBlog(db, accountId, blogId)
    if (!deleted) return { success: false, error: NOT_FOUND }
    // Its stored images go with it; a leftover costs storage, not correctness.
    after(() => deleteBlogImages(blogId))
    return { success: true }
  } catch (err) {
    return fail(err, 'The blog could not be deleted.')
  }
}

/** Making the image again runs while the user waits, under the function limit. */
const IMAGE_ACTION_TIMEOUT_MS = 150_000

/**
 * Makes the featured image again (with what the author asks for, if
 * anything) while the user waits, keeping the one it replaces as a version.
 */
export async function remakeFeaturedImage(
  blogId: string,
  raw: { direction?: unknown }
): Promise<{ success: true; blog: BlogEditorBlog } | Failure> {
  await requireUser()
  try {
    const parsed = parseInstruction(raw?.direction)
    if (!parsed.ok) return { success: false, error: parsed.error }
    if (!isAICapable) return { success: false, error: NOT_AI }
    const accountId = await requireIdentityId()
    const blog = await findIdentityBlog(db, accountId, blogId)
    if (!blog) return { success: false, error: NOT_FOUND }
    if (blog.generationStatus === 'generating' && !isGenerationStale(blog)) {
      return { success: false, error: GENERATING }
    }
    const current = blog.featuredImage
    const theme = await loadBrandTheme(accountId).catch(() => DEFAULT_BRAND_THEME)
    const made = await withAiSpend({ source: 'blogs', accountId }, () =>
      makeFeaturedImage(
        {
          blogId: blog.id,
          title: blog.title || blog.brief.topic,
          concept:
            blog.plan?.featuredImage.concept ||
            `An editorial picture about ${blog.brief.topic}`,
          alt: current?.alt || blog.plan?.featuredImage.alt || blog.title,
          style: blog.plan?.featuredImage.style ?? 'photo',
          theme,
          direction: parsed.instruction ?? undefined,
          abortSignal: AbortSignal.timeout(IMAGE_ACTION_TIMEOUT_MS)
        },
        FEATURED_IMAGE_DEPS
      )
    )
    if (made.image.status !== 'ready') {
      return { success: false, error: made.image.error }
    }
    const outcome = await setFeaturedImage(db, {
      accountId,
      blogId: blog.id,
      image: {
        ...made.image,
        caption: current?.status === 'ready' ? current.caption : ''
      },
      usage: made.usage
    })
    if (!outcome.ok)
      return { success: false, error: reasonError(outcome.reason) }
    return { success: true, blog: await editorBlogOf(outcome.blog) }
  } catch (err) {
    return fail(err, 'The image could not be made.')
  }
}

/** Takes the featured image off; it stays among the versions. */
export async function removeFeaturedImage(
  blogId: string
): Promise<{ success: true; blog: BlogEditorBlog } | Failure> {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const outcome = await setFeaturedImage(db, { accountId, blogId, image: null })
    if (!outcome.ok)
      return { success: false, error: reasonError(outcome.reason) }
    return { success: true, blog: await editorBlogOf(outcome.blog) }
  } catch (err) {
    return fail(err, 'The image could not be removed.')
  }
}

/** The featured image's bytes as a data URL, for an export that embeds it. */
export async function featuredImageData(
  blogId: string
): Promise<{ success: true; dataUrl: string | null } | Failure> {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    const blog = await findIdentityBlog(db, accountId, blogId)
    if (!blog) return { success: false, error: NOT_FOUND }
    const image = blog.featuredImage
    return {
      success: true,
      dataUrl: image?.status === 'ready' ? await loadImageDataUrl(image.src) : null
    }
  } catch (err) {
    return fail(err, 'The image could not be loaded.')
  }
}

/**
 * Checks the saved blog's citations again (after the author edited it):
 * each linked sentence against its source, recorded without changing text.
 */
export async function checkBlogSources(
  blogId: string,
  raw: { lockVersion?: unknown }
): Promise<
  { success: true; blog: BlogEditorBlog } | (Failure & { conflict?: true })
> {
  await requireUser()
  try {
    const lockVersion = Number(raw?.lockVersion)
    if (!Number.isInteger(lockVersion)) {
      return { success: false, error: 'Reload the page and try again.' }
    }
    if (!isAICapable) return { success: false, error: NOT_AI }
    const accountId = await requireIdentityId()
    const result = await withAiSpend({ source: 'blogs', accountId }, () =>
      checkBlogSourcesNow({ accountId, blogId, lockVersion })
    )
    if (!result.ok) {
      if ('error' in result) return { success: false, error: result.error }
      return result.reason === 'conflict'
        ? { success: false, error: CONFLICT, conflict: true }
        : { success: false, error: reasonError(result.reason) }
    }
    return { success: true, blog: await editorBlogOf(result.blog) }
  } catch (err) {
    return fail(err, 'The sources could not be checked.')
  }
}
