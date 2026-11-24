import { videoScriptOf, type PostText } from '@/lib/formats/text'
import { videoSpecOf, type VideoFormatId } from './formats'
import { AI_CLIP_SECONDS } from './models'

/**
 * The prompt a video model gets for a Reel or Short: built from the post's
 * script with no model call of its own, so a video costs the clip alone.
 * The script's shots become the clip's beats, their spoken words its
 * voiceover. Pure, so tests can read it.
 */

/** Most shots one 8-second clip can hold. */
const MAX_SHOTS = 3
/** Longest direction a reviewer may give for a regeneration. */
export const MAX_VIDEO_DIRECTION_CHARS = 500
/** Kept well inside what video models read. */
const MAX_PROMPT_CHARS = 3000

const clean = (text: string | undefined | null) =>
  (text ?? '').replace(/\s+/g, ' ').trim()
/** Speech marks inside a quoted line would end the quote early. */
const quotable = (text: string) => clean(text).replace(/"/g, "'")

export interface VideoPromptInput {
  formatId: VideoFormatId
  post: PostText
  /** The idea's title, as the clip's subject when the script has no picture for it. */
  topic?: string | null
  /** What the reviewer asked to change, for a regeneration. */
  direction?: string | null
}

export function buildVideoPrompt(input: VideoPromptInput): string {
  const spec = videoSpecOf(input.formatId)
  const script = videoScriptOf(input.post)
  const shots = script.shots.slice(0, MAX_SHOTS)
  const beat = AI_CLIP_SECONDS / Math.max(shots.length, 1)
  const topic = clean(input.topic) || clean(script.title)

  const lines = [
    `A vertical ${spec.aspectRatio} short-form social video for ${spec.label}: one continuous ${AI_CLIP_SECONDS}-second live-action clip that fills the whole vertical frame, edge to edge.`,
    topic ? `Subject: ${topic}.` : null,
    'Beats, in order:',
    ...shots.map((shot, i) => {
      const from = Math.round(i * beat)
      const to = Math.round((i + 1) * beat)
      const show =
        clean(shot.show) || `a picture that shows what the voiceover says`
      return `${i + 1}. (${from}–${to}s) Picture: ${show}. Voiceover: "${quotable(shot.say)}"`
    }),
    'Audio: one clear, natural voiceover says exactly the quoted lines, in order and unhurried, finishing before the clip ends; soft background sound under it.',
    'Look: realistic and well lit, modern, with smooth camera movement. Keep the main subject in the centre of the frame, clear of the top and bottom edges.',
    'No on-screen text, captions, subtitles, logos or watermarks. No phone mockup, device frame, bezel, border or picture-in-picture: the footage itself is the video.'
  ]
  const direction = clean(input.direction).slice(0, MAX_VIDEO_DIRECTION_CHARS)
  if (direction) lines.push(`The reviewer asks for this change: ${direction}`)
  return lines
    .filter((line): line is string => Boolean(line))
    .join('\n')
    .slice(0, MAX_PROMPT_CHARS)
}
