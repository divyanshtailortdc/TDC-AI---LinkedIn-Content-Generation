import 'server-only'

import { db } from '@/db'
import { accountsTable, brandThemesTable } from '@/db/schema'
import { DEFAULT_PRIMARY, resolveBrandTheme } from '@/lib/brand/theme'
import { viewableImageUrl } from '@/lib/media/image-store'
import { eq } from 'drizzle-orm'
import { docImages } from './doc'
import { blogToStandaloneHtml, type BlogPageMeta } from './render'
import { findSharedBlog } from './store'
import type { BlogContent, BlogImageView } from './types'

/**
 * The page a blog's public link shows: its saved text as the HTML export's
 * page, with the byline, pictures and diagrams. Pictures are signed links,
 * signed for each visit, since the bucket is private. Null when no blog is
 * shared under the token, or the one that is has no text yet.
 */
export async function sharedBlogPage(token: string): Promise<string | null> {
  const blog = await findSharedBlog(db, token)
  if (!blog || !blog.title.trim()) return null

  const sign = (src: string) =>
    viewableImageUrl(src).catch(error => {
      console.warn(`Could not sign an image of shared blog ${blog.id}:`, error)
      return null
    })
  const image = blog.featuredImage
  const shown = new Set(docImages(blog.content).map(node => node.attrs.imageId))
  const [account, theme, featuredSrc, pictures] = await Promise.all([
    db.query.accountsTable.findFirst({
      columns: { websiteUrl: true, name: true, accountType: true },
      where: eq(accountsTable.id, blog.accountId)
    }),
    db.query.brandThemesTable.findFirst({
      where: eq(brandThemesTable.accountId, blog.accountId)
    }),
    image?.status === 'ready' ? sign(image.src) : Promise.resolve(null),
    Promise.all(
      (blog.images ?? [])
        .filter(picture => shown.has(picture.id))
        .map(async picture => {
          const src = await sign(picture.src)
          const view: BlogImageView | null = src
            ? { src, width: picture.width, height: picture.height }
            : null
          return [picture.id, view] as const
        })
    )
  ])

  const content: BlogContent = {
    kind: blog.kind,
    title: blog.title,
    slug: blog.slug,
    metaTitle: blog.metaTitle,
    metaDescription: blog.metaDescription,
    primaryKeyword: blog.primaryKeyword,
    keywords: blog.keywords,
    searchIntent: blog.searchIntent ?? '',
    content: blog.content,
    faq: blog.faq,
    sources: blog.sources,
    featuredImage:
      image?.status === 'ready' && featuredSrc
        ? {
            src: featuredSrc,
            alt: image.alt,
            caption: image.caption,
            width: image.width,
            height: image.height
          }
        : null,
    verification: blog.verification ?? null,
    images: Object.fromEntries(
      pictures.flatMap(([id, view]) => (view ? [[id, view]] : []))
    ),
    entities: blog.plan?.entities ?? [],
    mainEntity: blog.plan?.mainEntity ?? ''
  }
  const website = account?.websiteUrl?.trim() || null
  const meta: BlogPageMeta = {
    siteName: account?.name ?? '',
    author: {
      name: account?.name ?? '',
      ...(website && {
        url: /^https?:\/\//i.test(website) ? website : `https://${website}`
      }),
      type: account?.accountType === 'company' ? 'Organization' : 'Person'
    },
    publishedUrl: blog.publishedUrl,
    datePublished: blog.publishedAt?.toISOString() ?? null,
    dateModified: blog.updatedAt.toISOString(),
    diagramColor:
      resolveBrandTheme(theme ?? null).primaryColor ?? DEFAULT_PRIMARY
  }
  return blogToStandaloneHtml(content, meta)
}
