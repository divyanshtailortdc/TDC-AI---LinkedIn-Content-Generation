'use server'

import { db } from '@/db'
import {
  articlesTable,
  ideasTable,
  postDraftsTable,
  postMediaTable
} from '@/db/schema'
import { requireOwnedArticle, requireOwnedIdea } from '@/lib/account-guard'
import {
  ARTICLE_LIMITS,
  ArticleContentSchema,
  countArticleWords
} from '@/lib/articles/blocks'
import {
  claimArticleForIdea,
  claimArticleRegeneration,
  expireStaleGeneration,
  snapshotOf
} from '@/lib/articles/claim'
import {
  generateCover,
  parseCoverUpload,
  storeCoverUpload
} from '@/lib/articles/cover'
import {
  linkCardOf,
  linkPostCommentary,
  validateArticleLink
} from '@/lib/articles/link-post'
import {
  htmlToArticleBlocks,
  sanitizeArticleBlocks
} from '@/lib/articles/sanitize'
import {
  canGenerateArticleFrom,
  isStaleGeneration
} from '@/lib/articles/status'
import { isUuid } from '@/lib/ids'
import { postCharCount } from '@/lib/post-text'
import { requireUser } from '@/lib/session'
import { and, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { isAICapable } from '~/lib/ai'
import { loadGenerationContext, loadIdeaContext } from '~/lib/ai/context'
import {
  buildArticleLintOptions,
  knowledgeOfSources
} from '~/lib/ai/pipeline/article-lint'
import {
  generateClaimedArticle,
  recordArticleSpend
} from '~/lib/ai/pipeline/article-run'
import { buildPostLintOptions } from '~/lib/ai/pipeline/post-lint'
import { addUsage, type CallUsage } from '~/lib/ai/usage'
import { runArticleLinter } from '~/lib/lint/article-linter'
import { runLinter } from '~/lib/lint/run-linter'
import { validateImageUrl } from '~/lib/media/image-input'
import {
  deleteDraftImages,
  loadImageDataUrl,
  storeImage,
  viewableImageUrl
} from '~/lib/media/image-store'
import { REVIEWER_URL_SOURCE } from '~/lib/media/media-source'

/**
 * Articles: long-form pieces written from an approved idea, beside the posts
 * written from it. Every action takes ids from the browser, so each one first
 * looks the row up under the signed-in user's identity (requireOwnedIdea /
 * requireOwnedArticle); another user's row is "not found".
 *
 * Generation answers at once: the article is claimed (one generation at a
 * time, one article per idea; src/lib/articles/claim.ts) and written after
 * the response, kept alive by `after` (a Vercel function is frozen once it
 * has answered otherwise). The editor polls fetchArticleStatus.
 */

type Fail = { success: false; error: string }
const fail = (err: unknown, fallback: string): Fail => ({
  success: false,
  error: err instanceof Error && err.message ? err.message : fallback
})

const NO_AI =
  'No AI provider is configured. Add ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to generate articles.'

/** An article being generated cannot be edited: the result would overwrite the edit. */
const notGenerating = (article: {
  generationStatus: string
  generationStartedAt: Date | null
}) => article.generationStatus !== 'generating' || isStaleGeneration(article)

/**
 * "Generate Article" on an approved idea: starts its article, or opens the
 * one it already has. Only ideas that were approved (approved, being drafted
 * as a post, or drafted) qualify, as for posts.
 */
export async function generateArticle(
  ideaId: string
): Promise<
  | {
      success: true
      articleId: string
      outcome: 'claimed' | 'generating' | 'exists'
    }
  | Fail
> {
  const user = await requireUser()
  try {
    const idea = await requireOwnedIdea(user.id, ideaId)
    if (!canGenerateArticleFrom(idea.status)) {
      throw new Error('Approve this idea before generating an article from it.')
    }
    if (!isAICapable) throw new Error(NO_AI)

    const result = await claimArticleForIdea(db, {
      accountId: idea.accountId,
      ideaId: idea.id,
      title: idea.title
    })
    if (result.outcome === 'claimed') {
      const claim = { articleId: result.articleId, claimedAt: result.claimedAt }
      after(() => generateClaimedArticle(claim))
    }
    revalidatePath('/articles')
    return {
      success: true,
      articleId: result.articleId,
      outcome: result.outcome
    }
  } catch (err) {
    return fail(err, 'Could not start the article.')
  }
}

/**
 * A new version of an article, with the reviewer's direction. The current
 * text is kept as the previous version and can be restored.
 */
export async function regenerateArticle(
  articleId: string,
  guidance?: string
): Promise<{ success: true } | Fail> {
  const user = await requireUser()
  try {
    const article = await requireOwnedArticle(user.id, articleId)
    if (!article.ideaId) {
      throw new Error(
        'The idea this article came from no longer exists, so it cannot be regenerated.'
      )
    }
    if (!isAICapable) throw new Error(NO_AI)
    const claim = await claimArticleRegeneration(db, {
      accountId: article.accountId,
      articleId: article.id,
      guidance: typeof guidance === 'string' ? guidance.slice(0, 1500) : null
    })
    if (!claim) throw new Error('This article is already being generated.')
    after(() => generateClaimedArticle(claim))
    revalidatePath('/articles')
    return { success: true }
  } catch (err) {
    return fail(err, 'Could not regenerate the article.')
  }
}

/** Where a generation stands, for the editor following it. */
export async function fetchArticleStatus(articleId: string): Promise<
  | {
      success: true
      generationStatus: 'generating' | 'ready' | 'failed'
      generationError: string | null
    }
  | Fail
> {
  const user = await requireUser()
  try {
    const article = await requireOwnedArticle(user.id, articleId)
    if (isStaleGeneration(article)) {
      await expireStaleGeneration(db, article.id)
      return {
        success: true,
        generationStatus: 'failed',
        generationError: 'Generation stopped before it finished. Try again.'
      }
    }
    return {
      success: true,
      generationStatus: article.generationStatus,
      generationError: article.generationError
    }
  } catch (err) {
    return fail(err, 'Could not check the article.')
  }
}

/**
 * Saves the reviewer's edits. The body arrives as the editor's HTML and is
 * reduced to the article blocks (anything else is dropped, so what is stored
 * is safe to render); the checks run again on the text as it now stands.
 */
export async function saveArticle(
  articleId: string,
  payload: {
    title: string
    subtitle: string
    html: string
    callToAction?: string | null
    coverImageAlt?: string | null
  }
) {
  const user = await requireUser()
  try {
    const article = await requireOwnedArticle(user.id, articleId)
    if (!notGenerating(article)) {
      throw new Error(
        'This article is being generated. Wait for it to finish before editing.'
      )
    }
    const title = String(payload?.title ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    const subtitle = String(payload?.subtitle ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!title) throw new Error('Give the article a title.')
    if (title.length > ARTICLE_LIMITS.titleChars) {
      throw new Error(
        `Keep the title under ${ARTICLE_LIMITS.titleChars} characters.`
      )
    }
    if (subtitle.length > ARTICLE_LIMITS.subtitleChars) {
      throw new Error(
        `Keep the subtitle under ${ARTICLE_LIMITS.subtitleChars} characters.`
      )
    }
    const html = String(payload?.html ?? '')
    if (html.length > 1_000_000)
      throw new Error('The article is too long to save.')
    const content = ArticleContentSchema.parse(htmlToArticleBlocks(html))
    const callToAction =
      String(payload?.callToAction ?? '')
        .trim()
        .slice(0, 1000) || null
    const coverImageAlt =
      String(payload?.coverImageAlt ?? '')
        .trim()
        .slice(0, 1000) || null

    let lintFindings = article.lintFindings
    try {
      const idea = article.ideaId
        ? await db.query.ideasTable.findFirst({
            where: eq(ideasTable.id, article.ideaId)
          })
        : null
      const ctx = idea
        ? await loadIdeaContext(idea, { platform: article.platform })
        : await loadGenerationContext(article.accountId, {
            goalIds: [],
            platform: article.platform
          })
      lintFindings = runArticleLinter(
        buildArticleLintOptions(
          ctx,
          idea ?? null,
          knowledgeOfSources(article.sources),
          {
            title,
            subtitle,
            content,
            callToAction
          }
        )
      )
    } catch (err) {
      // The text is still saved; the earlier checks are kept rather than lost.
      console.error(`Could not re-run the checks on article ${articleId}:`, err)
    }

    // A generation that went stale is settled as failed first, so the save
    // below can require "not generating" without exception.
    if (isStaleGeneration(article)) await expireStaleGeneration(db, article.id)

    const wordCount = countArticleWords(content)
    const [saved] = await db
      .update(articlesTable)
      .set({
        title,
        subtitle,
        content,
        callToAction,
        coverImageAlt,
        wordCount,
        lintFindings,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(articlesTable.id, article.id),
          // A regeneration that started since is not overwritten.
          ne(articlesTable.generationStatus, 'generating')
        )
      )
      .returning({ updatedAt: articlesTable.updatedAt })
    if (!saved) {
      throw new Error(
        'This article started generating again. Your edits were not saved.'
      )
    }
    return {
      success: true as const,
      content,
      wordCount,
      lintFindings,
      updatedAt: saved.updatedAt.toISOString()
    }
  } catch (err) {
    return fail(err, 'Could not save the article.')
  }
}

/** Puts back the text the last regeneration replaced; the current text becomes the previous. */
export async function restorePreviousArticleVersion(articleId: string) {
  const user = await requireUser()
  try {
    const article = await requireOwnedArticle(user.id, articleId)
    if (!notGenerating(article))
      throw new Error('This article is being generated.')
    const previous = article.previousVersion
    if (!previous?.content?.length)
      throw new Error('There is no earlier version to restore.')
    const content = sanitizeArticleBlocks(
      ArticleContentSchema.parse(previous.content)
    )
    if (isStaleGeneration(article)) await expireStaleGeneration(db, article.id)
    const [restored] = await db
      .update(articlesTable)
      .set({
        title: previous.title,
        subtitle: previous.subtitle,
        content,
        callToAction: previous.callToAction ?? null,
        wordCount: countArticleWords(content),
        previousVersion: {
          ...snapshotOf(article),
          replacedAt: new Date().toISOString()
        },
        updatedAt: new Date()
      })
      .where(
        and(
          eq(articlesTable.id, article.id),
          ne(articlesTable.generationStatus, 'generating')
        )
      )
      .returning({ id: articlesTable.id })
    if (!restored) throw new Error('This article started generating again.')
    revalidatePath(`/articles/${article.id}`)
    return { success: true as const }
  } catch (err) {
    return fail(err, 'Could not restore the earlier version.')
  }
}

/**
 * Sets the cover from an uploaded image (a data URL) or an image link.
 * Returns a link the browser can show.
 */
export async function setArticleCover(
  articleId: string,
  input: { dataUrl?: string; url?: string; altText?: string | null }
) {
  const user = await requireUser()
  try {
    const article = await requireOwnedArticle(user.id, articleId)
    let stored: string
    if (typeof input?.dataUrl === 'string' && input.dataUrl) {
      const image = parseCoverUpload(input.dataUrl)
      if ('error' in image) throw new Error(image.error)
      stored = await storeCoverUpload(article.id, image)
    } else if (typeof input?.url === 'string') {
      const problem = validateImageUrl(input.url)
      if (problem) throw new Error(problem)
      stored = input.url.trim()
    } else {
      throw new Error('Choose an image or paste an image link.')
    }
    const altText = String(input?.altText ?? '')
      .trim()
      .slice(0, 1000)
    await db
      .update(articlesTable)
      .set({
        coverImageUrl: stored,
        ...(altText ? { coverImageAlt: altText } : {}),
        updatedAt: new Date()
      })
      .where(eq(articlesTable.id, article.id))
    return { success: true as const, coverUrl: await viewableImageUrl(stored) }
  } catch (err) {
    return fail(err, 'Could not set the cover image.')
  }
}

export async function removeArticleCover(articleId: string) {
  const user = await requireUser()
  try {
    const article = await requireOwnedArticle(user.id, articleId)
    await db
      .update(articlesTable)
      .set({ coverImageUrl: null, updatedAt: new Date() })
      .where(eq(articlesTable.id, article.id))
    return { success: true as const }
  } catch (err) {
    return fail(err, 'Could not remove the cover image.')
  }
}

/**
 * Generates a 16:9 cover from the article and its suggested concept, with the
 * brand's colours and logo. Its cost goes on the idea's run and the article.
 */
export async function generateArticleCover(articleId: string) {
  const user = await requireUser()
  try {
    const article = await requireOwnedArticle(user.id, articleId)
    if (!notGenerating(article))
      throw new Error('Wait for the article to finish generating.')
    if (!(article.content ?? []).length)
      throw new Error('Generate or write the article first.')
    if (!isAICapable) throw new Error(NO_AI)
    const idea = article.ideaId
      ? ((await db.query.ideasTable.findFirst({
          where: eq(ideasTable.id, article.ideaId)
        })) ?? null)
      : null

    const startedAt = new Date()
    const result = await generateCover(article, idea)
    const error = 'error' in result ? result.error : null
    await recordArticleSpend({
      runId: idea?.runId ?? null,
      stage: 'media',
      articleId: article.id,
      usage: result.usage,
      summary: `Cover image for article "${article.title.slice(0, 120)}"`,
      startedAt,
      error,
      details: { phase: 'article_cover' }
    })
    const [current] = await db
      .select({ usage: articlesTable.usage })
      .from(articlesTable)
      .where(eq(articlesTable.id, article.id))
    await db
      .update(articlesTable)
      .set({
        usage: addUsage(
          current?.usage as Partial<CallUsage>,
          result.usage
        ) as unknown as Record<string, number>,
        ...('imageUrl' in result
          ? {
              coverImageUrl: result.imageUrl,
              coverImageAlt: article.coverImageAlt || result.altText
            }
          : {}),
        updatedAt: new Date()
      })
      .where(eq(articlesTable.id, article.id))
    if ('error' in result) throw new Error(result.error)
    return {
      success: true as const,
      coverUrl: await viewableImageUrl(result.imageUrl),
      altText: article.coverImageAlt || result.altText
    }
  } catch (err) {
    return fail(err, 'Could not generate a cover image.')
  }
}

/**
 * Marks the article published by hand on the platform (native articles
 * cannot be published through its API), with its link when given; or back
 * to draft.
 */
export async function setArticlePublished(
  articleId: string,
  input: { published: boolean; url?: string | null }
) {
  const user = await requireUser()
  try {
    const article = await requireOwnedArticle(user.id, articleId)
    let publishedUrl: string | null = null
    if (input?.published && input.url?.trim()) {
      const link = validateArticleLink(input.url)
      if ('error' in link) throw new Error(link.error)
      publishedUrl = link.url
    }
    const now = new Date()
    await db
      .update(articlesTable)
      .set(
        input?.published
          ? {
              status: 'published',
              publishedAt: now,
              publishedUrl,
              updatedAt: now
            }
          : {
              status: 'draft',
              publishedAt: null,
              publishedUrl: null,
              updatedAt: now
            }
      )
      .where(eq(articlesTable.id, article.id))
    revalidatePath('/articles')
    return {
      success: true as const,
      status: input?.published ? ('published' as const) : ('draft' as const),
      publishedUrl,
      publishedAt: input?.published ? now.toISOString() : null
    }
  } catch (err) {
    return fail(err, 'Could not update the article.')
  }
}

/**
 * Makes an article-link post: a post that shares the page where the article
 * is published as a link card (its title, subtitle and cover), with the
 * article's promo post as its text. It goes to Posts for review like any
 * post, and publishing it is the platform's ordinary post API.
 */
export async function createArticleLinkPost(
  articleId: string,
  input: { url: string; title?: string; description?: string }
) {
  const user = await requireUser()
  try {
    const article = await requireOwnedArticle(user.id, articleId)
    if (!notGenerating(article))
      throw new Error('Wait for the article to finish generating.')
    const link = validateArticleLink(String(input?.url ?? ''))
    if ('error' in link) throw new Error(link.error)
    const card = linkCardOf({
      title: String(input?.title ?? '').trim() || article.title,
      subtitle:
        input?.description !== undefined
          ? String(input.description)
          : article.subtitle
    })
    if (!card.title) throw new Error('Give the link a title.')
    const { hook, body } = linkPostCommentary(article)

    const draftId = crypto.randomUUID()
    // The cover is copied under the post, so deleting the article (and its
    // images) never takes the post's thumbnail with it.
    let coverUrl: string | null = null
    if (article.coverImageUrl) {
      try {
        coverUrl = /^https?:\/\//i.test(article.coverImageUrl)
          ? article.coverImageUrl
          : await storeImage(
              await loadImageDataUrl(article.coverImageUrl),
              draftId
            )
      } catch (err) {
        console.error(`Could not copy the cover of article ${article.id}:`, err)
      }
    }

    const idea = article.ideaId
      ? await db.query.ideasTable.findFirst({
          where: eq(ideasTable.id, article.ideaId)
        })
      : null
    let lintFindings: ReturnType<typeof runLinter> = []
    try {
      const ctx = idea
        ? await loadIdeaContext(idea, {
            lintOnly: true,
            platform: article.platform
          })
        : await loadGenerationContext(article.accountId, {
            goalIds: [],
            lintOnly: true,
            platform: article.platform
          })
      lintFindings = runLinter(
        buildPostLintOptions(ctx, idea ?? null, {
          hook,
          body,
          cta: null,
          hashtags: []
        })
      )
    } catch (err) {
      console.error(
        `Could not check the link post for article ${article.id}:`,
        err
      )
    }

    await db.transaction(async tx => {
      await tx.insert(postDraftsTable).values({
        id: draftId,
        accountId: article.accountId,
        ideaId: article.ideaId,
        platform: article.platform,
        hook,
        body,
        originalHook: hook,
        originalBody: body,
        cta: null,
        hashtags: [],
        format: 'article_link',
        charCount: postCharCount({ hook, body }),
        lintFindings,
        status: 'awaiting_review',
        articleId: article.id,
        linkUrl: link.url,
        linkTitle: card.title,
        linkDescription: card.description || null
      })
      if (coverUrl) {
        await tx.insert(postMediaTable).values({
          draftId,
          mode: 'stock',
          imageUrl: coverUrl,
          altText: article.coverImageAlt,
          metadata: {
            source: REVIEWER_URL_SOURCE,
            articleCover: true,
            articleId: article.id
          }
        })
      }
    })
    revalidatePath('/posts')
    return { success: true as const, draftId }
  } catch (err) {
    return fail(err, 'Could not create the link post.')
  }
}

/**
 * Deletes an article for good, with its images. Link posts made from it stay
 * (with their own copy of the cover).
 */
export async function deleteArticle(articleId: string) {
  const user = await requireUser()
  try {
    if (!isUuid(articleId)) throw new Error('Article not found')
    const article = await requireOwnedArticle(user.id, articleId)
    await db
      .delete(articlesTable)
      .where(
        and(
          eq(articlesTable.id, article.id),
          eq(articlesTable.accountId, article.accountId)
        )
      )
    await deleteDraftImages(article.id)
    revalidatePath('/articles')
    revalidatePath('/ideas')
    return { success: true as const }
  } catch (err) {
    return fail(err, 'Could not delete the article.')
  }
}
