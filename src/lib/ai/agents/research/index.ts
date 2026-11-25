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
import { inferRegion } from '../../region'
import { assertWithinAiSpendLimit, recordAiSpend } from '../../spend'
import {
  addUsage,
  EMPTY_USAGE,
  readCallUsage,
  type CallUsage
} from '../../usage'
import {
  keepVerifiedFindings,
  usablePage,
  type ResearchSeen
} from './guard'
import {
  MAX_FINDINGS,
  MAX_PAGE_READS,
  MAX_SEARCHES,
  MAX_STEPS,
  PAGE_CHARS,
  type ResearchLimits
} from './limits'
import { buildPrompt, INSTRUCTIONS } from './prompt'

export type { ResearchLimits } from './limits'

/** A run should not wait longer than this on research. */
const AGENT_TIMEOUT_MS = 180_000

const findingsSchema = (maxFindings: number) =>
  z.object({
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
      .describe(`Up to ${maxFindings} findings.`)
  })

/** A run's limits (./limits.ts): every caller that names none gets these. */
export const RUN_RESEARCH_LIMITS: ResearchLimits = {
  maxSteps: MAX_STEPS,
  maxSearches: MAX_SEARCHES,
  maxPageReads: MAX_PAGE_READS,
  maxFindings: MAX_FINDINGS
}

/** The agent failed part-way; `usage` is what its finished steps were billed. */
export class ResearchAgentError extends Error {
  constructor(
    message: string,
    readonly usage: CallUsage
  ) {
    super(message)
    this.name = 'ResearchAgentError'
  }
}

export type ResearchAgentResult = {
  findings: Finding[]
  /** For each finding, whether its quote was found on the page itself. */
  pageVerified: boolean[]
  queries: string[]
  pagesRead: string[]
  /** The title each page read gives itself, by URL. */
  pageTitles: Record<string, string>
  /** Proposed findings dropped by the guard. */
  rejected: number
  steps: number
  usage: CallUsage
  modelId: string
}

/**
 * What a caller other than a run (a blog's research) changes about the agent:
 * its instructions, its prompt, how long it may take and how far back its
 * searches look. Absent, each is what a run's research has always used.
 */
export type ResearchAgentOptions = {
  instructions?: string
  prompt?: string
  timeoutMs?: number
  /** 0 sets no date filter on the searches. */
  freshnessDays?: number
  /** A deeper or shallower search than a run's (RUN_RESEARCH_LIMITS). */
  limits?: ResearchLimits
}

/**
 * The one agent: decides what to search and which pages to read, within hard
 * limits, and returns verbatim quotes. Replaces only the fixed web search; the
 * findings feed the ideation skill exactly as fixed search results do.
 *
 * Throws when it cannot run (AiSpendLimitError past the spending limit), or a
 * `ResearchAgentError` with the spend so far when it fails mid-loop; the
 * caller falls back to fixed search. Each step is recorded in the usage
 * ledger as it ends.
 */
export async function runResearchAgent(
  ctx: GenerationContext,
  options: ResearchAgentOptions = {}
): Promise<ResearchAgentResult> {
  const handle = getLanguageModel('research')
  if (!handle) throw new Error('No AI provider configured for research.')
  // Without search the agent can only burn steps on empty results.
  if (!isWebSearchConfigured)
    throw new Error('Web search is not configured (SERPER_API_KEY).')
  await assertWithinAiSpendLimit()

  const freshnessDays = options.freshnessDays ?? ctx.prefs.research.freshness_days
  const country = inferRegion(ctx)?.code
  const limits = options.limits ?? RUN_RESEARCH_LIMITS
  const seen: ResearchSeen = new Map()
  const queries: string[] = []
  const pagesRead: string[] = []
  const pageTitles: Record<string, string> = {}

  const agent = new ToolLoopAgent({
    model: handle.model,
    providerOptions: handle.providerOptions,
    instructions: options.instructions ?? INSTRUCTIONS,
    tools: {
      searchWeb: tool({
        description:
          'Search the web. Returns result titles, URLs, snippets and dates.',
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => {
          if (queries.length >= limits.maxSearches) {
            return { error: `Search limit (${limits.maxSearches}) reached.` }
          }
          queries.push(query)
          const results = await searchWeb(query, { freshnessDays, country })
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
          if (pagesRead.length >= limits.maxPageReads) {
            return { error: `Page limit (${limits.maxPageReads}) reached.` }
          }
          pagesRead.push(url)
          try {
            const page = await scrapeUrl(url)
            const text = page.content.slice(0, PAGE_CHARS)
            entry.text = `${entry.finding.snippet}\n${text}`
            // A bot check or error page names nothing and proves nothing.
            const usable = usablePage({ title: page.title, content: text })
            if (usable) {
              entry.pageText = usable.text
              if (usable.title) pageTitles[url] = usable.title
            }
            return { url, title: page.title, text }
          } catch {
            return { error: 'The page could not be read.' }
          }
        }
      })
    },
    stopWhen: isStepCount(limits.maxSteps),
    // The last step, or any step once both budgets are spent, must answer:
    // without this the agent can use every step on tools and return nothing.
    prepareStep: async ({ stepNumber }) =>
      stepNumber >= limits.maxSteps - 1 ||
      (queries.length >= limits.maxSearches &&
        pagesRead.length >= limits.maxPageReads)
        ? { activeTools: [], toolChoice: 'none' }
        : undefined,
    output: Output.object({ schema: findingsSchema(limits.maxFindings) })
  })

  // Kept as steps finish, because a timeout or error throws away `result`
  // and with it the steps that were already billed.
  let billedSoFar: CallUsage = EMPTY_USAGE
  // The ledger rows being written, one per step; never rejected.
  const recorded: Array<Promise<void>> = []
  let result
  try {
    result = await agent.generate({
      prompt: options.prompt ?? buildPrompt(ctx, freshnessDays),
      timeout: options.timeoutMs ?? AGENT_TIMEOUT_MS,
      onStepEnd: step => {
        const usage = readCallUsage(step, handle.modelId)
        billedSoFar = addUsage(billedSoFar, usage)
        recorded.push(
          recordAiSpend({ stage: 'research', modelId: handle.modelId, usage })
        )
      }
    })
  } catch (err) {
    await Promise.all(recorded)
    throw new ResearchAgentError(
      err instanceof Error ? err.message : 'Research agent failed',
      billedSoFar
    )
  }
  await Promise.all(recorded)

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
  const { findings, rejected, pageVerified } = keepVerifiedFindings(
    proposed,
    seen,
    limits.maxFindings
  )

  return {
    findings,
    pageVerified,
    queries,
    pagesRead,
    pageTitles,
    rejected,
    steps: result.steps.length,
    usage,
    modelId: handle.modelId
  }
}
