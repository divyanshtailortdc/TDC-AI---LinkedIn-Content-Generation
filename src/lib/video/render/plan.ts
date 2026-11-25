import { videoScriptOf, type PostText } from '@/lib/formats/text'

/**
 * What a Reel or Short shows, segment by segment, as the product-video
 * recorder films it (./record.ts): the hook on a title card, each line of
 * the script on a slide with its on-screen text, then the call to action on
 * a closing card. Built from the post's script alone, with no model call, and
 * stored as the video's prompt, so a render that is tried again films the
 * same thing. Pure, so tests can read it.
 */

export interface PlannedCard {
  /** Small text above the title. */
  kicker?: string
  title: string
  subtitle?: string
  /** What the shot shows, as the script describes it: the brief for its picture. */
  visual?: string
  /** How long the card stays up, in milliseconds. */
  holdMs: number
}

export interface PlannedScene {
  /** Lowercase letters, digits and hyphens: names the recording. */
  key: string
  /** "01": the slide's number among the slides. */
  num: string
  /** Shown big on the slide: the shot's on-screen text, or its line. */
  headline: string
  /** The shot's line, as a caption under the headline; none when it is the headline. */
  caption?: string
  /** What the shot shows, as the script describes it: the brief for its picture. */
  visual?: string
  holdMs: number
}

export interface VideoPlan {
  version: 1
  intro: PlannedCard
  scenes: PlannedScene[]
  /** The call to action, when the script has one. */
  outro: PlannedCard | null
}

/**
 * Reading pace for on-screen text: time to read every word once at a
 * relaxed pace, and the big words again, at a Reel's quick rhythm.
 */
const MS_PER_WORD = 260
const BASE_MS = 1200
const CARD_MS = { min: 2400, max: 4600 }
const SCENE_MS = { min: 2600, max: 6000 }
/** Most slides one video holds; a longer script is cut, keeping its ending. */
const MAX_SCENES = 8
/** Kept under a minute: every platform takes that as a Reel or Short. */
const MAX_TOTAL_MS = 58_000
/** Longest text a slide or card shows; the type shrinks to fit up to this. */
const MAX_TEXT_CHARS = 220

const clamp = (value: number, range: { min: number; max: number }) =>
  Math.min(range.max, Math.max(range.min, Math.round(value)))

const words = (...texts: Array<string | undefined>) =>
  texts.join(' ').trim().split(/\s+/).filter(Boolean).length

/**
 * On-screen text: one line of plain words. Emoji are dropped, because the
 * server's browser has no emoji font and would draw empty boxes.
 */
export function screenText(text: string | null | undefined): string {
  const clean = (text ?? '')
    .replace(
      /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim()
  if (clean.length <= MAX_TEXT_CHARS) return clean
  const cut = clean.slice(0, MAX_TEXT_CHARS)
  const space = cut.lastIndexOf(' ')
  return `${(space > MAX_TEXT_CHARS * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`
}

/** Longest picture brief kept from a shot. */
const MAX_VISUAL_CHARS = 400

/** A shot's description of what it shows, on one line; none when empty. */
function visualOf(show: string | undefined): { visual?: string } {
  const flat = (show ?? '').replace(/\s+/g, ' ').trim()
  return flat ? { visual: flat.slice(0, MAX_VISUAL_CHARS) } : {}
}

/** A shot's big text and its caption: the caption only when it adds words. */
function headlineAndCaption(shot: { say: string; onScreenText?: string }) {
  const say = screenText(shot.say)
  const onScreen = screenText(shot.onScreenText)
  if (!onScreen) return { headline: say, caption: undefined }
  // The same words, whatever their punctuation ("fridge: khaali", "fridge khaali")
  const plain = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  const same = plain(onScreen) === plain(say)
  return { headline: onScreen, caption: same || !say ? undefined : say }
}

export interface PlanInput {
  post: PostText
  /** Small text on the opening card, such as the platform; none by default. */
  kicker?: string | null
}

export function planVideo({ post, kicker }: PlanInput): VideoPlan {
  const shots = videoScriptOf(post).shots.filter(shot => screenText(shot.say))
  const [first, ...rest] = shots
  const hook = first
    ? headlineAndCaption(first)
    : { headline: screenText(post.hook), caption: undefined }

  // The last line is the call to action when the post has one.
  const hasCta = Boolean(post.cta?.trim()) && rest.length > 0
  const middle = hasCta ? rest.slice(0, -1) : rest
  const ending = hasCta ? rest[rest.length - 1] : undefined

  // A long script keeps its first slides and its last one.
  const kept =
    middle.length > MAX_SCENES
      ? [...middle.slice(0, MAX_SCENES - 1), middle[middle.length - 1]!]
      : middle

  const intro: PlannedCard = {
    ...(screenText(kicker) ? { kicker: screenText(kicker) } : {}),
    title: hook.headline,
    ...(hook.caption ? { subtitle: hook.caption } : {}),
    ...visualOf(first?.show),
    holdMs: clamp(
      BASE_MS + words(hook.headline, hook.caption) * MS_PER_WORD,
      CARD_MS
    )
  }
  const scenes: PlannedScene[] = kept.map((shot, i) => {
    const { headline, caption } = headlineAndCaption(shot)
    return {
      key: `slide-${i + 1}`,
      num: String(i + 1).padStart(2, '0'),
      headline,
      ...(caption ? { caption } : {}),
      ...visualOf(shot.show),
      holdMs: clamp(BASE_MS + words(headline, caption) * MS_PER_WORD, SCENE_MS)
    }
  })
  let outro: PlannedCard | null = null
  if (ending) {
    const { headline, caption } = headlineAndCaption(ending)
    outro = {
      title: headline,
      ...(caption ? { subtitle: caption } : {}),
      ...visualOf(ending.show),
      holdMs: clamp(
        BASE_MS + words(headline, caption) * MS_PER_WORD + 600,
        CARD_MS
      )
    }
  }

  // Over the limit: the slides give up time first, down to their shortest.
  const total = () =>
    intro.holdMs +
    (outro?.holdMs ?? 0) +
    scenes.reduce((sum, scene) => sum + scene.holdMs, 0)
  const over = total() - MAX_TOTAL_MS
  if (over > 0 && scenes.length > 0) {
    const spare = scenes.reduce((sum, s) => sum + (s.holdMs - SCENE_MS.min), 0)
    const share = spare > 0 ? Math.min(1, over / spare) : 0
    for (const scene of scenes) {
      scene.holdMs = Math.round(
        scene.holdMs - (scene.holdMs - SCENE_MS.min) * share
      )
    }
  }

  return { version: 1, intro, scenes, outro }
}

/**
 * The plan at the look's pace: every hold longer or shorter by `factor`,
 * the whole kept under a minute. A factor of 1 leaves it as it is.
 */
export function withPace(plan: VideoPlan, factor: number): VideoPlan {
  if (factor === 1) return plan
  const total =
    plan.intro.holdMs +
    (plan.outro?.holdMs ?? 0) +
    plan.scenes.reduce((sum, scene) => sum + scene.holdMs, 0)
  const f = Math.min(factor, MAX_TOTAL_MS / Math.max(total, 1))
  const hold = (ms: number) => Math.round(ms * f)
  return {
    ...plan,
    intro: { ...plan.intro, holdMs: hold(plan.intro.holdMs) },
    scenes: plan.scenes.map(scene => ({
      ...scene,
      holdMs: hold(scene.holdMs)
    })),
    outro: plan.outro
      ? { ...plan.outro, holdMs: hold(plan.outro.holdMs) }
      : null
  }
}

/**
 * About how long the finished video runs, in seconds: each segment's hold,
 * plus the moments around it the recorder adds (./record.ts).
 */
export function plannedSeconds(plan: VideoPlan): number {
  const ms =
    plan.intro.holdMs +
    750 +
    (plan.outro ? plan.outro.holdMs + 300 : 0) +
    plan.scenes.reduce((sum, scene) => sum + scene.holdMs + 400, 0)
  return Math.round(ms / 1000)
}

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_TEXT_CHARS + 1
const isVisual = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_VISUAL_CHARS
const isHold = (value: unknown): value is number =>
  typeof value === 'number' && value >= 500 && value <= 15_000

function readCard(value: unknown): PlannedCard | null {
  const card = value as Partial<PlannedCard> | null
  if (!card || !isText(card.title) || !isHold(card.holdMs)) return null
  if (card.kicker !== undefined && !isText(card.kicker)) return null
  if (card.subtitle !== undefined && !isText(card.subtitle)) return null
  if (card.visual !== undefined && !isVisual(card.visual)) return null
  return {
    ...(card.kicker ? { kicker: card.kicker } : {}),
    title: card.title,
    ...(card.subtitle ? { subtitle: card.subtitle } : {}),
    ...(card.visual ? { visual: card.visual } : {}),
    holdMs: card.holdMs
  }
}

/** A plan read back from a video's stored prompt; throws when it is not one. */
export function parsePlan(stored: string): VideoPlan {
  let value: Partial<VideoPlan> | null = null
  try {
    value = JSON.parse(stored)
  } catch {
    // Reported below.
  }
  const intro = readCard(value?.intro)
  const outro = value?.outro === null ? null : readCard(value?.outro)
  const scenes = Array.isArray(value?.scenes)
    ? value.scenes.filter(
        (s): s is PlannedScene =>
          Boolean(s) &&
          /^[a-z0-9-]+$/.test(s.key) &&
          isText(s.num) &&
          isText(s.headline) &&
          (s.caption === undefined || isText(s.caption)) &&
          (s.visual === undefined || isVisual(s.visual)) &&
          isHold(s.holdMs)
      )
    : null
  if (
    value?.version !== 1 ||
    !intro ||
    !scenes ||
    scenes.length !== value.scenes?.length ||
    scenes.length > MAX_SCENES ||
    (value.outro !== null && !outro)
  ) {
    throw new Error('The video plan stored with this video cannot be read.')
  }
  return { version: 1, intro, scenes, outro }
}

/** Most new pictures one video gets: the hook and up to two of its lines. */
export const MAX_SCENE_PICTURES = 3

/** A segment chosen for a picture of its own, with what the picture carries. */
export interface ScenePick {
  /** The segment's key: 'intro' or a scene's key. */
  key: string
  role: 'cover' | 'content'
  headline: string
  caption?: string
  visual?: string
}

/**
 * Which segments get a picture made for them: the hook always, then lines
 * spread through the middle so pictured scenes and word scenes take turns.
 * The call to action stays the brand's closing card. Pure.
 */
export function pickSceneSegments(
  plan: VideoPlan,
  max = MAX_SCENE_PICTURES
): ScenePick[] {
  if (max <= 0) return []
  const picks: ScenePick[] = [
    {
      key: 'intro',
      role: 'cover',
      headline: plan.intro.title,
      ...(plan.intro.subtitle ? { caption: plan.intro.subtitle } : {}),
      ...(plan.intro.visual ? { visual: plan.intro.visual } : {})
    }
  ]
  const n = plan.scenes.length
  const want = Math.min(max - 1, n)
  const chosen = new Set<number>()
  for (let k = 1; k <= want; k++) {
    let i = Math.min(
      n - 1,
      Math.max(0, Math.round((k * (n + 1)) / (want + 1)) - 1)
    )
    while (chosen.has(i) && i < n - 1) i++
    chosen.add(i)
  }
  for (const i of [...chosen].sort((a, b) => a - b)) {
    const scene = plan.scenes[i]!
    picks.push({
      key: scene.key,
      role: 'content',
      headline: scene.headline,
      ...(scene.caption ? { caption: scene.caption } : {}),
      ...(scene.visual ? { visual: scene.visual } : {})
    })
  }
  return picks
}

/**
 * Which picture each scene without its own sits on, blurred, by segment
 * key: the nearest picture that is not on a neighbouring scene (the one
 * just shown, or the next one's own), so no picture is seen twice in a row;
 * the nearest at all when there is no other. `order` is every segment's key
 * in the order they play. Pure.
 */
export function backdropKeys(
  order: readonly string[],
  pictured: readonly string[]
): Record<string, string> {
  const at = new Map(
    pictured.filter(k => order.includes(k)).map(k => [k, order.indexOf(k)])
  )
  if (at.size === 0) return {}
  const out: Record<string, string> = {}
  order.forEach((key, i) => {
    if (at.has(key)) return
    const before = order[i - 1]
    const after = order[i + 1]
    const neighbours = new Set(
      [
        before === undefined
          ? undefined
          : at.has(before)
            ? before
            : out[before],
        after !== undefined && at.has(after) ? after : undefined
      ].filter(Boolean)
    )
    // Nearest first; at the same distance, the one already seen
    const distance = (j: number) => Math.abs(j - i) + (j > i ? 0.5 : 0)
    const nearest = [...at.entries()]
      .sort(([, a], [, b]) => distance(a) - distance(b))
      .map(([k]) => k)
    out[key] = nearest.find(k => !neighbours.has(k)) ?? nearest[0]!
  })
  return out
}
