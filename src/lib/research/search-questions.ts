/**
 * The questions a Google results page carries besides its links: "People
 * also ask" and the related searches at the foot of the page. Pure: it reads
 * a Serper response; web-search.ts makes the call.
 *
 * Only the questions are kept. The answer under each "People also ask" entry
 * is a snippet from a page of any quality, so it is never evidence.
 */

export type QuestionResults = {
  /** "People also ask", as Google words them. */
  questions: string[]
  /** Related searches, as typed by searchers. */
  related: string[]
}

export const NO_QUESTIONS: QuestionResults = { questions: [], related: [] }

const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

/** The questions and related searches of one Serper response; none when it has neither. */
export function parseQuestionResults(data: unknown): QuestionResults {
  if (!data || typeof data !== 'object') return NO_QUESTIONS
  const record = data as Record<string, unknown>
  const list = (value: unknown) => (Array.isArray(value) ? value : [])
  const questions = list(record.peopleAlsoAsk)
    .map(item => text((item as Record<string, unknown> | null)?.question))
    .filter(q => q.length >= 8 && q.length <= 200)
  const related = list(record.relatedSearches)
    .map(item => text((item as Record<string, unknown> | null)?.query))
    .filter(q => q.length >= 3 && q.length <= 120)
  return { questions, related }
}
