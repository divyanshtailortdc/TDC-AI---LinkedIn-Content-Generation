import type { QuestionResults } from '~/lib/research/search-questions'
import type { SearchQuestion } from './types'

/**
 * The questions people search about a piece's topic, put together from the
 * searches made for it (src/lib/ai/pipeline/blog-questions.ts), and the
 * helpers that match the plan's and the text's questions against them. Pure.
 */

export const MAX_SEARCH_QUESTIONS = 12
export const MAX_RELATED_SEARCHES = 8

/** A question or phrase reduced to its words: case, punctuation and spacing ignored. */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Every search's questions, then its related searches, each once, in the
 * order the searches were made (the primary phrase's first).
 */
export function mergeSearchQuestions(
  results: QuestionResults[],
  limits: { questions?: number; related?: number } = {}
): SearchQuestion[] {
  const seen = new Set<string>()
  const take = (texts: string[], origin: SearchQuestion['origin'], max: number) => {
    const out: SearchQuestion[] = []
    for (const text of texts) {
      const key = normalizeQuestion(text)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push({ text: text.trim(), origin })
      if (out.length >= max) break
    }
    return out
  }
  const questions = take(
    results.flatMap(r => r.questions),
    'people_also_ask',
    limits.questions ?? MAX_SEARCH_QUESTIONS
  )
  const related = take(
    results.flatMap(r => r.related),
    'related',
    limits.related ?? MAX_RELATED_SEARCHES
  )
  return [...questions, ...related]
}

const STOP_WORDS = new Set(
  'a an the of to in on for and or is are was were be do does did can could should would will what how why when which who where whats hows your you my i it its this that with vs versus'.split(
    ' '
  )
)

const contentWords = (text: string) =>
  normalizeQuestion(text)
    .split(' ')
    .filter(word => word && !STOP_WORDS.has(word))

/**
 * The search question `text` copies, or null. The same words count, and so
 * does a close rewording (four in five of the content words shared both
 * ways), since a plan may tidy a question's grammar.
 */
export function matchSearchQuestion(
  text: string,
  questions: SearchQuestion[]
): SearchQuestion | null {
  const key = normalizeQuestion(text)
  if (!key) return null
  const exact = questions.find(q => normalizeQuestion(q.text) === key)
  if (exact) return exact
  const words = new Set(contentWords(text))
  if (words.size === 0) return null
  let best: { question: SearchQuestion; score: number } | null = null
  for (const question of questions) {
    const theirs = new Set(contentWords(question.text))
    if (theirs.size === 0) continue
    const shared = [...words].filter(word => theirs.has(word)).length
    const score = Math.min(shared / words.size, shared / theirs.size)
    if (score >= 0.8 && (!best || score > best.score)) best = { question, score }
  }
  return best?.question ?? null
}

const QUESTION_START =
  /^(how|what|why|when|which|who|whom|whose|where|can|could|should|would|will|is|are|was|were|do|does|did|has|have)\b/i

/** A heading written as a question. */
export function isQuestionHeading(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.endsWith('?') || QUESTION_START.test(trimmed)
}

/** The first words of a topic, as a search phrase when no better one is known. */
export function topicSearchPhrase(topic: string, maxWords = 8): string {
  return topic
    .replace(/[“”"]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(' ')
    .replace(/[.,;:!?]+$/, '')
}
