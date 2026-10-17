/**
 * Up to two initials for an avatar, from the first letters of a name's words.
 * Characters are taken whole: `word[0]` returns half of an emoji (or of any
 * character outside the Basic Multilingual Plane), which renders as "�".
 */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(word => Array.from(word)[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
