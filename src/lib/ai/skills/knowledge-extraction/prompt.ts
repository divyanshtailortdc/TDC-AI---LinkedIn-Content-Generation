/** What the model sees of a document; longer ones are cut, not summarized. */
export const DOCUMENT_PROMPT_CHARS = 15000

export const INSTRUCTIONS =
  'You extract verified factual claims with verbatim supporting quotes for a knowledge base. Every quote must be copied character-for-character from the source document.'

export function buildPrompt(input: { title: string; content: string }): string {
  return `Analyze this document.

Title: ${input.title}

Content:
${input.content.slice(0, DOCUMENT_PROMPT_CHARS)}`
}
