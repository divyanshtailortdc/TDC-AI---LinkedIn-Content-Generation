/**
 * The part of an inbound address before the @, e.g. `test` in
 * `test@inbox.tdcai.com`: what may be used, and the names suggested for the
 * person who owns a workspace. Pure, so the rules are tested on their own;
 * src/lib/mail/addresses.ts stores and assigns them.
 */

const LOCAL_PART_MIN = 2
export const LOCAL_PART_MAX = 40

/** Lower-case letters and digits, with single dots, hyphens or underscores between them. */
const LOCAL_PART = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

/**
 * Never given out. The mail system's own names (`catchall` is the mailbox
 * every address delivers into), and the ones certificate authorities email to
 * prove control of a domain: whoever received those could get a certificate
 * for it.
 */
const RESERVED = new Set([
  'abuse',
  'admin',
  'administrator',
  'catchall',
  'hostmaster',
  'mailer-daemon',
  'no-reply',
  'nobody',
  'noreply',
  'postmaster',
  'root',
  'security',
  'webmaster'
])

/** Dropped from a name: they say nothing about who someone is. */
const HONORIFICS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'mx',
  'dr',
  'prof',
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
  'phd'
])

/** Letters NFKD does not split into a base letter and an accent. */
const LIGATURES: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ł: 'l',
  þ: 'th'
}

/** Numbered alternatives (`test.sisodia2`) are tried only after every name. */
const MAX_NUMBERED = 99

/** Why `localPart` cannot be an address, in words for the form, or null. */
export function localPartError(localPart: string): string | null {
  if (!localPart) return 'Enter an address.'
  if (localPart.length < LOCAL_PART_MIN)
    return `Use at least ${LOCAL_PART_MIN} characters.`
  if (localPart.length > LOCAL_PART_MAX)
    return `Use at most ${LOCAL_PART_MAX} characters.`
  if (!LOCAL_PART.test(localPart))
    return 'Use letters and numbers, with single dots, hyphens or underscores between them.'
  if (RESERVED.has(localPart)) return 'That address is reserved.'
  return null
}

/** What someone typed as the local part: trimmed, lower-case, without `@<domain>`. */
export function normalizeLocalPart(input: string, domain: string) {
  const value = input.trim().toLowerCase()
  const suffix = `@${domain.toLowerCase()}`
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value
}

/** Accents and ligatures as plain a–z, then only what an address may hold. */
function ascii(text: string, keep: RegExp) {
  return text
    .toLowerCase()
    .replace(/[ßæœøđłþ]/g, letter => LIGATURES[letter] ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(keep, '')
}

/** Separators only between letters and digits, never two in a row. */
function tidy(slug: string) {
  return slug.replace(/[._-]{2,}/g, m => m[0]!).replace(/^[._-]+|[._-]+$/g, '')
}

/** "Dr. test Sisodia (TDC)" → ['test', 'sisodia']. Hyphenated names stay whole. */
function nameWords(name: string) {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map(word => tidy(ascii(word, /[^a-z0-9-]+/g)))
    .filter(word => word && !HONORIFICS.has(word))
}

/** `test.Sisodia+news@gmail.com` → `test.sisodia`. */
function emailUsername(email: string) {
  const local = email.slice(0, email.lastIndexOf('@')).split('+')[0] ?? ''
  return tidy(ascii(local, /[^a-z0-9._-]+/g))
}

/**
 * The addresses to offer the person who owns a workspace, best first: their
 * first name, then first.last (`test`, `test.sisodia`), the username of
 * the email they sign in with, other forms of their name, and only then
 * first.last with a number. Every one is valid and not reserved; empty when
 * neither the name nor the email has any letters or digits to use.
 */
export function addressCandidates(holder: {
  name: string
  email: string
}): string[] {
  const words = nameWords(holder.name)
  const first = words[0]
  const last = words.length > 1 ? words.at(-1) : undefined
  const username = emailUsername(holder.email)

  const named = [
    first,
    first && last && `${first}.${last}`,
    username,
    first && last && `${first[0]}.${last}`,
    first && last && `${first}${last}`,
    first && last && `${last}.${first}`
  ]
  const base = (first && last ? `${first}.${last}` : first) || username
  const numbered = base
    ? Array.from({ length: MAX_NUMBERED - 1 }, (_, i) => {
        const n = String(i + 2)
        return `${tidy(base.slice(0, LOCAL_PART_MAX - n.length))}${n}`
      })
    : []

  const seen = new Set<string>()
  return [...named, ...numbered].filter((candidate): candidate is string => {
    if (!candidate || seen.has(candidate) || localPartError(candidate))
      return false
    seen.add(candidate)
    return true
  })
}
