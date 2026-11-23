import {
  CONTENT_STYLES,
  CREATABLE_PLATFORMS,
  EMOJI_LEVELS,
  type ContentStyle,
  type EmojiLevel,
  type PlatformId
} from '@/lib/formats'
import {
  ACCOUNT_TYPES,
  EMPTY_PROFILE,
  type AccountType,
  type IdentityProfileField
} from '@/lib/identity-profile'

/**
 * What the create-identity wizard keeps in the browser until the identity is
 * created, so leaving it half way (to find a profile link, or for the day)
 * does not lose what was typed: platforms, the description, the reviewed
 * profile and each platform's style. The AI's suggestions for voice, goals
 * and knowledge are not kept (the setup draft still starts blank). Parsed
 * defensively: it comes from storage anyone can edit, and from older
 * versions of the wizard.
 */

export const CREATE_STEPS = ['where', 'about', 'review'] as const
export type CreateStep = (typeof CREATE_STEPS)[number]

type ProfileLinks = Partial<Record<PlatformId, string>>
type ChannelNote = { audience?: string; tone?: string; emoji?: EmojiLevel }

export type CreateProgress = {
  step: CreateStep
  platforms: PlatformId[]
  about: { description: string; links: ProfileLinks; websiteUrl: string }
  values: Record<IdentityProfileField, string>
  links: ProfileLinks
  accountType: AccountType
  styles: Partial<Record<PlatformId, ContentStyle>>
  notes: Partial<Record<PlatformId, ChannelNote>>
  usedAi: boolean
}

const VERSION = 1

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

const oneOf = <T extends string>(
  list: readonly T[],
  value: unknown
): T | undefined =>
  (list as readonly unknown[]).includes(value) ? (value as T) : undefined

/** Only the picked platforms, each with text. */
function linksOf(value: unknown, platforms: PlatformId[]): ProfileLinks {
  const raw = record(value)
  return Object.fromEntries(
    platforms.flatMap(p =>
      typeof raw[p] === 'string' ? [[p, raw[p] as string]] : []
    )
  )
}

export function parseCreateProgress(raw: string | null): CreateProgress | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const saved = record(data)
  if (saved.v !== VERSION) return null
  const step = oneOf(CREATE_STEPS, saved.step)
  if (!step) return null

  const platforms = (
    Array.isArray(saved.platforms) ? saved.platforms : []
  ).filter((p): p is PlatformId =>
    CREATABLE_PLATFORMS.includes(p as PlatformId)
  )
  const about = record(saved.about)
  const values = record(saved.values)
  const styles = record(saved.styles)
  const notes = record(saved.notes)
  return {
    // A later step needs platforms picked.
    step: platforms.length > 0 ? step : 'where',
    platforms,
    about: {
      description: text(about.description),
      links: linksOf(about.links, platforms),
      websiteUrl: text(about.websiteUrl)
    },
    values: Object.fromEntries(
      Object.keys(EMPTY_PROFILE).map(key => [key, text(values[key])])
    ) as Record<IdentityProfileField, string>,
    links: linksOf(saved.links, platforms),
    accountType: oneOf(ACCOUNT_TYPES, saved.accountType) ?? 'personal',
    styles: Object.fromEntries(
      platforms.flatMap(p => {
        const style = oneOf(CONTENT_STYLES, styles[p])
        return style ? [[p, style]] : []
      })
    ),
    notes: Object.fromEntries(
      platforms.flatMap(p => {
        if (!(p in notes)) return []
        const note = record(notes[p])
        const emoji = oneOf(EMOJI_LEVELS, note.emoji)
        return [
          [
            p,
            {
              ...(typeof note.audience === 'string' && {
                audience: note.audience
              }),
              ...(typeof note.tone === 'string' && { tone: note.tone }),
              ...(emoji && { emoji })
            }
          ]
        ]
      })
    ),
    usedAi: saved.usedAi === true
  }
}

/** The JSON kept for `progress`. */
export const serializeCreateProgress = (progress: CreateProgress) =>
  JSON.stringify({ v: VERSION, ...progress })

/** Where it is kept: one for the first identity, one for adding another. */
export const createProgressKey = (another: boolean) =>
  `identity-create-progress:${another ? 'another' : 'first'}`
