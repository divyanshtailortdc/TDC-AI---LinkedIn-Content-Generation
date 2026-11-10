import type { ArticleSource, Idea } from '@/db/schema'
import {
  inlineFromPlainText,
  isEmptyBlock,
  type ArticleBlock
} from '@/lib/articles/blocks'
import type { GenerationContext } from '../../context-blocks'
import { collectFigureSources } from '../post-drafting/guard'
import type { ArticleGenerationResult, ArticleSectionBlock } from './schema'

/**
 * What a generated article must have to be worth reviewing, and how the
 * model's sections become the stored blocks. Pure functions, so tests run
 * them without a model.
 */

/** A passage retrieved from the author's knowledge base for this article. */
export type ArticleKnowledgePassage = {
  documentId: string
  title: string
  url?: string | null
  content: string
}

const filled = (text: string | undefined | null) => Boolean(text?.trim())

/**
 * A title, an introduction and at least two sections that each say
 * something. Platform and voice rules are the article checks' job
 * (src/lib/lint/article-linter.ts).
 */
export function isCompleteArticle(
  article: ArticleGenerationResult | null | undefined
): article is ArticleGenerationResult {
  if (!article || !filled(article.title)) return false
  if (!(article.introduction || []).some(filled)) return false
  const sections = (article.sections || []).filter(
    s =>
      filled(s.heading) &&
      (s.blocks || []).some(b => filled(b.text) || (b.items || []).some(filled))
  )
  return sections.length >= 2
}

function sectionBlock(block: ArticleSectionBlock): ArticleBlock | null {
  switch (block.type) {
    case 'subheading':
      return filled(block.text)
        ? { type: 'heading', level: 3, text: inlineFromPlainText(block.text!) }
        : null
    case 'quote':
      return filled(block.text)
        ? { type: 'quote', text: inlineFromPlainText(block.text!) }
        : null
    case 'bullets':
    case 'numbered': {
      const items = (block.items || []).filter(filled).map(inlineFromPlainText)
      // A list the model sent as text: kept as a paragraph rather than lost.
      if (items.length === 0) {
        return filled(block.text)
          ? { type: 'paragraph', text: inlineFromPlainText(block.text!) }
          : null
      }
      return { type: 'list', ordered: block.type === 'numbered', items }
    }
    default:
      return filled(block.text)
        ? { type: 'paragraph', text: inlineFromPlainText(block.text!) }
        : null
  }
}

/** A paragraph field the model may have split itself with blank lines. */
const paragraphs = (texts: string[] | undefined) =>
  (texts || [])
    .flatMap(t => t.split(/\n\s*\n/))
    .filter(filled)
    .map((t): ArticleBlock => ({
      type: 'paragraph',
      text: inlineFromPlainText(t)
    }))

/**
 * The model's article as editor blocks: the introduction, each section under
 * its heading, then the closing section. The title, subtitle and call to
 * action are stored in their own fields.
 */
export function toArticleBlocks(
  article: ArticleGenerationResult
): ArticleBlock[] {
  const blocks: ArticleBlock[] = [...paragraphs(article.introduction)]
  for (const section of article.sections || []) {
    if (!filled(section.heading)) continue
    blocks.push({
      type: 'heading',
      level: 2,
      text: inlineFromPlainText(section.heading)
    })
    for (const block of section.blocks || []) {
      const converted = sectionBlock(block)
      if (converted) blocks.push(converted)
    }
  }
  const closing = paragraphs(article.conclusion)
  if (closing.length > 0) {
    if (filled(article.conclusionHeading)) {
      blocks.push({
        type: 'heading',
        level: 2,
        text: inlineFromPlainText(article.conclusionHeading)
      })
    }
    blocks.push(...closing)
  }
  return blocks.filter(b => !isEmptyBlock(b))
}

/** "E3" → the third evidence item; "K1" → the first knowledge passage. */
function parseSourceId(id: string): { kind: 'E' | 'K'; index: number } | null {
  const m = /^\s*\[?([EK])(\d{1,3})\]?\s*$/i.exec(id)
  if (!m) return null
  return { kind: m[1]!.toUpperCase() as 'E' | 'K', index: Number(m[2]) - 1 }
}

/**
 * The sources kept beside the article: every evidence item and knowledge
 * passage it was given, each marked `used` when the model says it relied on
 * it. When it named none it could be held to, the evidence counts as used
 * (the idea was approved on it). All are kept, used or not, so the checks on
 * a later save read the same sources the article was written from.
 */
export function articleSources(
  idea: Pick<Idea, 'supportingEvidence'>,
  passages: ArticleKnowledgePassage[],
  sourcesUsed: string[] | undefined
): ArticleSource[] {
  const evidence = idea.supportingEvidence || []
  const used = (sourcesUsed || [])
    .map(parseSourceId)
    .filter(
      (s): s is NonNullable<ReturnType<typeof parseSourceId>> => s !== null
    )
  const usedKey = new Set(used.map(s => `${s.kind}${s.index}`))
  const nothingNamed = usedKey.size === 0

  const all: ArticleSource[] = [
    ...evidence.map((e, i): ArticleSource => ({
      kind: 'evidence',
      title: e.sourceTitle || 'Idea evidence',
      url: e.sourceUrl || null,
      claim: e.claim,
      used: nothingNamed || usedKey.has(`E${i}`)
    })),
    ...passages.map((p, i): ArticleSource => ({
      kind: 'knowledge',
      title: p.title,
      url: p.url || null,
      claim: p.content.replace(/\s+/g, ' ').trim().slice(0, 1200),
      used: usedKey.has(`K${i}`)
    }))
  ]

  const seen = new Set<string>()
  const out: ArticleSource[] = []
  for (const source of all) {
    const key = `${source.kind}|${source.url ?? ''}|${source.title}|${source.claim ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(source)
  }
  return out
}

/**
 * Everything an article's figures may come from: what a post's may (the
 * idea, its evidence and the author's details) plus the knowledge passages
 * retrieved for it. The article checks flag any figure in none of it.
 */
export function collectArticleFigureSources(
  ctx: GenerationContext,
  idea: Parameters<typeof collectFigureSources>[1],
  passages: Array<Pick<ArticleKnowledgePassage, 'content'>>
): string {
  return [collectFigureSources(ctx, idea), ...passages.map(p => p.content)]
    .filter(Boolean)
    .join('\n')
}
