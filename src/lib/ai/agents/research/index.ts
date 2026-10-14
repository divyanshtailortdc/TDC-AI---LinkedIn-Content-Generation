import 'server-only'

import { getLanguageModel } from '@/lib/ai'
import {
  isWebSearchConfigured,
  searchWeb,
  type Finding
} from '@/lib/research/web-search'
import { scrapeUrl } from '@/lib/scraper'
import { isStepCount, Output, tool, ToolLoopAgent } from 'ai'
import { z } from 'zod'
import type { GenerationContext } from '../../context'
import {
  addUsage,
  EMPTY_USAGE,
  readCallUsage,
  type CallUsage
} from '../../usage'
import { keepVerifiedFindings, type ResearchSeen } from './guard'
import {
  MAX_FINDINGS,
  MAX_PAGE_READS,
  MAX_SEARCHES,
  MAX_STEPS,
  PAGE_CHARS
} from './limits'
import { buildPrompt, INSTRUCTIONS } from './prompt'

/** A run should not wait longer than this on research. */
const AGENT_TIMEOUT_MS = 180_000

const FindingsSchema = z.object({
  findings: z
    .array(
      z.object({
        url: z
          .string()
          .describe('A URL returned by searchWeb, exactly as given.'),
        quote: z
          .string()
          .describe('Words copied exactly from that result snippet or page.')
      })
    )
    .describe(`Up to ${MAX_FINDINGS} findings.`)
})

export type ResearchAgentResult = {
  findings: Finding[]
  queries: string[]
  pagesRead: string[]
  /** Proposed findings dropped by the guard. */
  rejected: number
  steps: number
  usage: CallUsage
  modelId: string
}

/**
 * The one agent: decides what to search and which pages to read, within hard
 * limits, and returns verbatim quotes. Replaces only the fixed web search; the
 * findings feed the ideation skill exactly as fixed search results do.
 *
 * Throws when it cannot run or fails; the caller falls back to fixed search.
 */
export async function runResearchAgent(
  ctx: GenerationContext
): Promise<ResearchAgentResult> {
  const handle = getLanguageModel('research')
  if (!handle) throw new Error('No AI provider configured for research.')
  // Without search the agent can only burn steps on empty results.
  if (!isWebSearchConfigured)
    throw new Error('Web search is not configured (SERPER_API_KEY).')

  const freshnessDays = ctx.prefs.research.freshness_days
  const seen: ResearchSeen = new Map()
  const queries: string[] = []
  const pagesRead: string[] = []

  const agent = new ToolLoopAgent({
    model: handle.model,
    providerOptions: handle.providerOptions,
    instructions: INSTRUCTIONS,
    tools: {
      searchWeb: tool({
        description:
          'Search the web. Returns result titles, URLs, snippets and dates.',
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => {
          if (queries.length >= MAX_SEARCHES) {
            return { error: `Search limit (${MAX_SEARCHES}) reached.` }
          }
          queries.push(query)
          const results = await searchWeb(query, { freshnessDays })
          for (const r of results) {
            if (!seen.has(r.url))
              seen.set(r.url, { finding: r, text: r.snippet })
          }
          return results.map(r => ({
            url: r.url,
            title: r.title,
            snippet: r.snippet,
            date: r.publishedAt ?? null
          }))
        }
      }),
      readPage: tool({
        description: 'Read the text of a page that searchWeb returned.',
        inputSchema: z.object({ url: z.string() }),
        execute: async ({ url }) => {
          const entry = seen.get(url)
          if (!entry)
            return { error: 'Only URLs returned by searchWeb can be read.' }
          if (pagesRead.length >= MAX_PAGE_READS) {
            return { error: `Page limit (${MAX_PAGE_READS}) reached.` }
          }
          pagesRead.push(url)
          try {
            const page = await scrapeUrl(url)
            const text = page.content.slice(0, PAGE_CHARS)
            entry.text = `${entry.finding.snippet}\n${text}`
            return { url, title: page.title, text }
          } catch {
            return { error: 'The page could not be read.' }
          }
        }
      })
    },
    stopWhen: isStepCount(MAX_STEPS),
    // The last step, or any step once both budgets are spent, must answer:
    // without this the agent can use every step on tools and return nothing.
    prepareStep: async ({ stepNumber }) =>
      stepNumber >= MAX_STEPS - 1 ||
      (queries.length >= MAX_SEARCHES && pagesRead.length >= MAX_PAGE_READS)
        ? { activeTools: [], toolChoice: 'none' }
        : undefined,
    output: Output.object({ schema: FindingsSchema })
  })

  const result = await agent.generate({
    prompt: buildPrompt(ctx, freshnessDays),
    timeout: AGENT_TIMEOUT_MS
  })

  // Per step, so a gateway-billed cost is read from each call.
  const usage = result.steps.reduce(
    (total, step) => addUsage(total, readCallUsage(step, handle.modelId)),
    EMPTY_USAGE
  )
  // Reading `output` throws when the last step produced none; the spend above
  // still counts, and the caller falls back to fixed search on no findings.
  let proposed: Array<{ url: string; quote: string }> = []
  try {
    proposed = result.output?.findings ?? []
  } catch (err) {
    console.warn('Research agent produced no final answer:', err)
  }
  const { findings, rejected } = keepVerifiedFindings(proposed, seen)

  return {
    findings,
    queries,
    pagesRead,
    rejected,
    steps: result.steps.length,
    usage,
    modelId: handle.modelId
  }
}
