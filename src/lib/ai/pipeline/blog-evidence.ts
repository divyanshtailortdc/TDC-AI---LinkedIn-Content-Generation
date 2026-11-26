import 'server-only'

import type { Idea } from '@/db/schema'
import type { BlogBrief, BlogKind, BlogSource } from '@/lib/blogs/types'
import { ownHosts } from '@/lib/research/source-credibility'
import { isWebSearchConfigured } from '@/lib/research/web-search'
import { scrapeUrl } from '@/lib/scraper'
import { ResearchAgentError, runResearchAgent } from '../agents/research'
import {
  blogFreshnessDays,
  blogResearchInstructions,
  buildBlogResearchPrompt,
  researchLimitsFor
} from '../agents/research/blog-prompt'
import type { GenerationContext } from '../context-blocks'
import { retrieveKnowledgePassages } from '../embeddings'
import { inferRegion } from '../region'
import { addUsage, EMPTY_USAGE, type CallUsage } from '../usage'
import {
  confirmSnippetFigures,
  ideaSourcesFrom,
  knowledgeSourcesFrom,
  MAX_KNOWLEDGE_SOURCES,
  numberSources,
  webSourcesFrom
} from './blog-sources'

/** Research may take this long; planning and writing follow inside the 300 s limit. */
export const BLOG_RESEARCH_TIMEOUT_MS = 100_000
/** Confirming snippet figures on their pages, all at once. */
const CONFIRM_TIMEOUT_MS = 10_000

/** A page's text for confirming a quote, or null when it cannot be read in time. */
async function pageText(url: string): Promise<string | null> {
  const page = await Promise.race([
    scrapeUrl(url),
    new Promise<null>(resolve => setTimeout(() => resolve(null), CONFIRM_TIMEOUT_MS))
  ]).catch(() => null)
  return page?.content ?? null
}

export const NO_SEARCH_KEY_NOTE =
  'Web research is not set up (no search key), so this was written without web sources.'
export const RESEARCH_FAILED_NOTE =
  'Web research failed, so this was written without web sources.'

/**
 * The evidence a blog is written from: web research on its topic (when
 * asked for and set up), the identity's knowledge passages closest to it
 * (when asked for), and the evidence of the idea it came from. A research
 * failure is not fatal: the blog is written without web sources and a note
 * says so. `usage` is what the research cost.
 */
export async function gatherBlogSources(
  ctx: GenerationContext,
  input: {
    brief: BlogBrief
    idea: Idea | null
    onStage: (stage: 'research' | 'knowledge') => Promise<unknown>
    /** Absent: a blog post's research depth. */
    kind?: BlogKind
  }
): Promise<{ sources: BlogSource[]; usage: CallUsage; notes: string[] }> {
  const { brief } = input
  const limits = researchLimitsFor(input.kind ?? 'blog')
  let usage: CallUsage = EMPTY_USAGE
  const notes: string[] = []

  const hosts = ownHosts([
    ctx.account.websiteUrl,
    ...ctx.offerings.map(o => o.url)
  ])
  let web: BlogSource[] = []
  if (brief.research) {
    if (!isWebSearchConfigured) {
      notes.push(NO_SEARCH_KEY_NOTE)
    } else {
      await input.onStage('research')
      const region = inferRegion(ctx)
      try {
        const result = await runResearchAgent(ctx, {
          instructions: blogResearchInstructions(limits),
          prompt: buildBlogResearchPrompt(ctx, {
            topic: brief.topic,
            primaryKeyword: brief.primaryKeyword,
            secondaryKeywords: brief.secondaryKeywords,
            style: brief.style,
            freshnessDays: blogFreshnessDays(brief.style),
            kind: input.kind
          }),
          timeoutMs: BLOG_RESEARCH_TIMEOUT_MS,
          freshnessDays: blogFreshnessDays(brief.style),
          limits
        })
        usage = addUsage(usage, result.usage)
        web = webSourcesFrom(
          result.findings.map((finding, i) => ({
            ...finding,
            verifiedOn: result.pageVerified[i] ? 'page' : 'snippet'
          })),
          {
            regionCode: region?.code,
            regionName: region?.name,
            ownHosts: hosts,
            pageTitles: result.pageTitles
          }
        )
        // A figure seen only in a search snippet is checked on its page.
        web = await confirmSnippetFigures(web, pageText)
      } catch (err) {
        if (err instanceof ResearchAgentError)
          usage = addUsage(usage, err.usage)
        console.warn('Blog research failed; writing without web sources:', err)
        notes.push(RESEARCH_FAILED_NOTE)
      }
    }
  }

  let knowledge: BlogSource[] = []
  if (brief.knowledge && ctx.knowledgeDocs.length > 0) {
    await input.onStage('knowledge')
    // More passages than sources: cleaning drops menus, and one document's
    // passages become one source.
    const passages = await retrieveKnowledgePassages(ctx, ctx.knowledgeDocs, {
      queries: [brief.topic, brief.primaryKeyword, ...brief.secondaryKeywords],
      limit: MAX_KNOWLEDGE_SOURCES * 2
    })
    knowledge = knowledgeSourcesFrom(passages, ctx.knowledgeDocs, hosts)
  }

  return {
    sources: numberSources(web, ideaSourcesFrom(input.idea), knowledge),
    usage,
    notes
  }
}
