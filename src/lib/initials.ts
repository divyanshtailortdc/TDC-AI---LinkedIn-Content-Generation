const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The first user-perceived character of a word, or '' for an empty one. */
function firstGrapheme(word: string): string {
  return graphemes.segment(word)[Symbol.iterator]().next().value?.segment ?? ''
}

/**
 * Up to two initials for an avatar, from the first letters of a name's words.
 * Characters are taken whole, as the reader sees them: `word[0]` returns half
 * of an emoji, and even a code point is only a piece of a flag (two regional
 * indicators), a skin-toned emoji or a joined one (ZWJ), which render as
 * boxed letters or lose their parts. Graphemes keep each one in one piece.
 */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(firstGrapheme)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
