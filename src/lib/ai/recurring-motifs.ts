/**
 * The concrete things an account's recent ideas and posts keep coming back
 * to: a food, a setting, a running joke ("fries", "group chat", "delivery
 * fee"). A model asked for fresh ideas reaches for the same few typical
 * scenes again and again, and rewords them enough that no text comparison
 * calls them repeats; naming them is what steers it elsewhere.
 *
 * Pure word counting, so it is cheap, testable and the same every time.
 * Words of the account's own goals, offerings and profile are never flagged:
 * they are what its posts are meant to be about.
 */

export interface Motif {
  /** As it was most often written, e.g. "group chat". */
  phrase: string
  /** How many of the items mention it. */
  count: number
}

/** Words that carry no subject of their own. */
const STOP_WORDS = new Set(
  `a about above after again against all almost also am an and any are aren't as at be because been before being below
  between both but by can cannot could did do does doing don't down during each even ever every few for from further
  get gets getting got had has have having he her here hers herself him himself his how however i if in into is isn't it
  it's its itself just let let's like make makes making many may me might more most much must my myself never no nor not
  now of off on once one only or other our ours ourselves out over own per put rather really same say says see seen she
  should since so some still such than that that's the their theirs them themselves then there these they this those
  through to too under until up upon us very was wasn't we well were what when where whether which while who whom whose
  why will with within without would yet you your yours yourself yourselves you're we're they're i'm it'll we'll you'll
  isn't doesn't didn't won't can't shouldn't wouldn't couldn't i'll i've i'd we've you've they'll`
    .split(/\s+/)
    // Compared after apostrophes are taken out: "let's" is counted as "lets".
    .map(w => w.replace(/'/g, ''))
)

/**
 * Words that name a post's form or are filler in titles and hooks, not a
 * subject: "POV", "hot take", "episode", "myth vs reality", "things", "ways".
 */
const FORM_WORDS = new Set(
  `pov hot take takes episode episodes part series myth myths reality vs versus reacting reaction react day life behind
  scenes storytime story stories tutorial guide tip tips trend challenge relatable moment moments stage stages type types
  thing things way ways time times new real actually truly finally first last next every always never nobody everyone
  someone anyone everything something anything nothing people person post posts caption reel video carousel slide
  slides swipe edition version vote quick little big lot lots bit kind sort exactly literally basically probably maybe
  sure okay ok yes no not still already even ever good bad best worst better worse great real two three four five six
  seven eight nine ten one zero half whole full top said says saying tell told ask asked know knew think thought want
  wanted need needs going gone come came look looks looking feel feels try tried keep kept give gave took find found
  show shows showed turn turns`.split(/\s+/)
)

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')

/** A crude singular, so "fries" and "fry", "chats" and "chat" count as one. */
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (
    word.length > 3 &&
    word.endsWith('s') &&
    !word.endsWith('ss') &&
    !word.endsWith('us')
  ) {
    return word.slice(0, -1)
  }
  return word
}

/** The words of a text worth counting, in order, as [stem, as written]. */
function contentWords(text: string): Array<[string, string]> {
  return normalize(text)
    .split(/[\s-]+/)
    .filter(w => w.length > 2 && !/^\d+$/.test(w))
    .filter(w => !STOP_WORDS.has(w) && !FORM_WORDS.has(w))
    .map(w => [stem(w), w] as [string, string])
}

/**
 * What at least `minItems` of `items` mention (and at least one in ten of
 * them), most mentioned first. A two-word phrase stands for its words when
 * it accounts for most of their mentions ("group chat", not "group" and
 * "chat"). `exclude` is text whose words are never flagged: the account's
 * goals, offerings and profile.
 */
export function recurringMotifs(
  items: string[],
  options: {
    exclude?: string
    minItems?: number
    max?: number
    /** Fewer items than this say nothing about a habit; none is flagged. */
    minTexts?: number
  } = {}
): Motif[] {
  const texts = items.map(t => t.trim()).filter(Boolean)
  if (texts.length === 0 || texts.length < (options.minTexts ?? 1)) return []
  const minItems = Math.max(
    options.minItems ?? 3,
    Math.ceil(texts.length * 0.1)
  )
  const excluded = new Set(contentWords(options.exclude ?? '').map(([s]) => s))

  const df = new Map<string, number>()
  const written = new Map<string, Map<string, number>>()
  const note = (key: string, surface: string) => {
    const forms = written.get(key) ?? new Map<string, number>()
    forms.set(surface, (forms.get(surface) ?? 0) + 1)
    written.set(key, forms)
  }

  for (const text of texts) {
    const words = contentWords(text)
    const seen = new Set<string>()
    for (let i = 0; i < words.length; i++) {
      const [s, w] = words[i]!
      if (!excluded.has(s)) {
        seen.add(s)
        note(s, w)
      }
      const next = words[i + 1]
      // A phrase of two subject words, at least one of them the account's own
      // is fine ("delivery fee" when "delivery" is in a goal).
      if (next && !(excluded.has(s) && excluded.has(next[0]))) {
        const key = `${s} ${next[0]}`
        seen.add(key)
        note(key, `${w} ${next[1]}`)
      }
    }
    for (const key of seen) df.set(key, (df.get(key) ?? 0) + 1)
  }

  const frequent = [...df.entries()].filter(([, n]) => n >= minItems)
  const phrases = frequent.filter(([k]) => k.includes(' '))
  // A word goes when a phrase containing it covers most of its mentions.
  const covered = new Set<string>()
  for (const [phrase, n] of phrases) {
    for (const word of phrase.split(' ')) {
      if (n >= 0.6 * (df.get(word) ?? 0)) covered.add(word)
    }
  }
  const kept = frequent.filter(([k]) =>
    k.includes(' ') ? true : !covered.has(k) && !excluded.has(k)
  )

  const surface = (key: string) =>
    [...(written.get(key) ?? new Map<string, number>()).entries()].sort(
      (a, b) => b[1] - a[1]
    )[0]?.[0] ?? key

  return kept
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, options.max ?? 8)
    .map(([key, count]) => ({ phrase: surface(key), count }))
}
