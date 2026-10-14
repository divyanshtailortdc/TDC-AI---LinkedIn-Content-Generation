/**
 * Pulls a JSON object out of model text that may be wrapped in a code fence or
 * surrounded by prose. Returns null when there is nothing parseable.
 */
export function parseJsonLoosely(text: string | undefined): unknown {
  if (!text) return null
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = fenced?.[1] ?? text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}
