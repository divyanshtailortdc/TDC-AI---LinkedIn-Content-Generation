import {
  MediaAnalysisSchema,
  type MediaAnalysis
} from '~/lib/ai/skills/media-post/schema'
import { UPLOAD_NOTES_MAX_CHARS, uploadedMediaOf } from './rules'

/**
 * What a post made from uploaded media keeps of how its media was understood
 * (in payload.upload, beside its kind, file name and summary): the AI's
 * analysis of it and the author's notes, so Regenerate can write its hook,
 * body or whole text again without looking at the media again. Pure.
 */

/** Longest analysis kept with a post, as JSON: a few kilobytes is usual. */
const STORED_ANALYSIS_MAX_CHARS = 20_000

/**
 * An analysis kept before its features were ranked, grouped and tied to
 * frames (2026-11-27), in today's shape: an important feature becomes a
 * supporting one in a group of its own, its frames unknown. One kept before
 * features were listed at all has none.
 */
function upgraded(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const message = (value as { message?: unknown }).message
  if (!message || typeof message !== 'object') return value
  const features = (message as { features?: unknown }).features
  return {
    ...value,
    message: {
      ...message,
      features: Array.isArray(features)
        ? features.map(f =>
            f && typeof f === 'object'
              ? {
                  frames: [],
                  group: typeof f.name === 'string' ? f.name : '',
                  priority: f.important === true ? 'supporting' : 'minor',
                  ...f
                }
              : f
          )
        : []
    }
  }
}

/** An analysis as sent back by the browser or read from a post; null when it is not one. */
export function parseMediaAnalysis(value: unknown): MediaAnalysis | null {
  const parsed = MediaAnalysisSchema.safeParse(upgraded(value))
  if (!parsed.success) return null
  return JSON.stringify(parsed.data).length <= STORED_ANALYSIS_MAX_CHARS
    ? parsed.data
    : null
}

/**
 * For a post saved before its analysis was kept (or one whose analysis no
 * longer reads): all that is known of the media is its one-line summary,
 * and the post's own text.
 */
export function analysisFromSummary(summary: string): MediaAnalysis {
  return {
    summary: summary.trim() || 'Not recorded.',
    details: [],
    visibleText: [],
    mood: '',
    uncertain: [],
    message: {
      kind: 'other',
      subject: '',
      problem: '',
      audience: '',
      value: '',
      features: [],
      scaffolding: []
    }
  }
}

/** The payload.upload fields kept for Regenerate, as stored. */
export function storedAnalysisFields(input: {
  analysis: MediaAnalysis | null
  notes: string
}): { analysis?: MediaAnalysis; notes?: string } {
  const notes = input.notes.trim().slice(0, UPLOAD_NOTES_MAX_CHARS)
  return {
    ...(input.analysis ? { analysis: input.analysis } : {}),
    ...(notes ? { notes } : {})
  }
}

/**
 * The media a saved post was made from, as Regenerate writes from it; null
 * for a post not made from uploaded media.
 */
export function storedUploadOf(
  payload: Record<string, unknown> | null | undefined
): {
  kind: 'image' | 'video'
  analysis: MediaAnalysis
  notes: string
  /** False when only the summary was kept (analysisFromSummary). */
  analysed: boolean
} | null {
  const upload = uploadedMediaOf(payload)
  if (!upload) return null
  const raw = payload?.upload as Record<string, unknown>
  const analysis = parseMediaAnalysis(raw.analysis)
  const notes =
    typeof raw.notes === 'string'
      ? raw.notes.slice(0, UPLOAD_NOTES_MAX_CHARS)
      : ''
  return {
    kind: upload.kind,
    analysis: analysis ?? analysisFromSummary(upload.summary),
    notes,
    analysed: analysis !== null
  }
}
