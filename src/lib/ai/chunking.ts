export interface ChunkOptions {
  maxWords?: number
  overlapWords?: number
  maxChunks?: number
}

const countWords = (text: string) => text.split(' ').filter(Boolean).length

function splitOversized(sentence: string, maxWords: number): string[] {
  const words = sentence.split(' ').filter(Boolean)
  if (words.length <= maxWords) return [sentence]
  const parts: string[] = []
  for (let i = 0; i < words.length; i += maxWords) {
    parts.push(words.slice(i, i + maxWords).join(' '))
  }
  return parts
}

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxWords = Math.max(1, options.maxWords ?? 300)
  const overlapWords = Math.min(
    Math.max(0, options.overlapWords ?? 40),
    Math.floor(maxWords / 2)
  )
  const maxChunks = Math.max(1, options.maxChunks ?? 200)

  const sentences = text
    .split(/\n\s*\n/)
    .flatMap(paragraph =>
      paragraph
        .replace(/\s+/g, ' ')
        .trim()
        .split(/(?<=[.?!])\s+/)
    )
    .filter(Boolean)
    .flatMap(sentence => splitOversized(sentence, maxWords))

  const chunks: string[] = []
  let current: string[] = []
  let currentWords = 0

  for (const sentence of sentences) {
    const words = countWords(sentence)

    if (current.length > 0 && currentWords + words > maxWords) {
      chunks.push(current.join(' '))
      if (chunks.length >= maxChunks) return chunks

      const carried: string[] = []
      let carriedWords = 0
      for (const previous of [...current].reverse()) {
        const w = countWords(previous)
        if (carriedWords + w > overlapWords) break
        carried.unshift(previous)
        carriedWords += w
      }
      const fits = carriedWords + words <= maxWords
      current = fits ? carried : []
      currentWords = fits ? carriedWords : 0
    }

    current.push(sentence)
    currentWords += words
  }

  if (current.length > 0) chunks.push(current.join(' '))
  return chunks
}
