import 'server-only'

import { mergeSearchQuestions, topicSearchPhrase } from '@/lib/blogs/questions'
import type { BlogBrief, SearchQuestion } from '@/lib/blogs/types'
import { isWebSearchConfigured, searchQuestions } from '@/lib/research/web-search'
import type { GenerationContext } from '../context-blocks'
import { inferRegion } from '../region'
import { makeSearchPhrases } from '../skills/blog-search-phrases'
import { SkillError } from '../run-skill'
import { EMPTY_USAGE, type CallUsage } from '../usage'

/** One question search may take this long; they run at once, beside research. */
export const QUESTION_SEARCH_TIMEOUT_MS = 8_000

/** Searches made for questions, at most: the main phrase and two more. */
const MAX_QUESTION_SEARCHES = 3

export type GatheredQuestions = {
  questions: SearchQuestion[]
  /** What readers type for the topic: the brief's keyword, or phrases made for it. */
  phrases: string[]
  usage: CallUsage
}

export type QuestionDeps = {
  searchQuestions: typeof searchQuestions
  makeSearchPhrases: typeof makeSearchPhrases
  searchConfigured: boolean
}

const DEFAULT_DEPS: QuestionDeps = {
  searchQuestions,
  makeSearchPhrases,
  searchConfigured: isWebSearchConfigured
}

/**
 * The questions people search about a piece's topic ("People also ask" and
 * related searches), read on searches for what readers type: the brief's
 * primary keyword, or, when it has none, 2-3 phrases a small model call
 * makes from the topic (the topic's first words when that fails), plus the
 * secondary keywords up to three searches. Only with research on and search
 * set up. Never throws: a failure gives fewer questions or none.
 */
export async function gatherSearchQuestions(
  ctx: GenerationContext,
  brief: BlogBrief,
  deps: Partial<QuestionDeps> = {}
): Promise<GatheredQuestions> {
  const d = { ...DEFAULT_DEPS, ...deps }
  if (!brief.research || !d.searchConfigured) {
    return { questions: [], phrases: [], usage: EMPTY_USAGE }
  }
  const region = inferRegion(ctx)
  let usage: CallUsage = EMPTY_USAGE
  let phrases: string[] = []
  if (brief.primaryKeyword.trim()) {
    phrases = [brief.primaryKeyword.trim()]
  } else {
    try {
      const made = await d.makeSearchPhrases({
        topic: brief.topic,
        audience: brief.audience.note,
        secondaryKeywords: brief.secondaryKeywords,
        region: region?.name ?? null
      })
      usage = made.usage
      phrases = made.phrases
    } catch (error) {
      if (error instanceof SkillError) usage = error.usage ?? EMPTY_USAGE
      // A spending limit stops the whole generation; research hits it too.
      console.warn('Search phrases failed; searching the topic itself:', error)
    }
    if (phrases.length === 0) {
      const fallback = topicSearchPhrase(brief.topic)
      if (fallback) phrases = [fallback]
    }
  }
  const queries: string[] = []
  for (const query of [...phrases, ...brief.secondaryKeywords]) {
    const key = query.trim().toLowerCase()
    if (key && !queries.some(q => q.toLowerCase() === key)) queries.push(query.trim())
    if (queries.length >= MAX_QUESTION_SEARCHES) break
  }
  const results = await Promise.all(
    queries.map(query =>
      d
        .searchQuestions(query, {
          country: region?.code,
          timeoutMs: QUESTION_SEARCH_TIMEOUT_MS
        })
        .catch(() => ({ questions: [], related: [] }))
    )
  )
  return { questions: mergeSearchQuestions(results), phrases, usage }
}
