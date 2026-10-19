/** The voice settings a person picks; words to avoid are not one of them. */
export type VoiceChoices = {
  derivedStyleRubric?: string
  rawSamplesText?: string
  tone?: string
  perspective?: string
  emojiPolicy?: string
  hashtagPolicy?: string
  formality?: number
  directness?: number
}

/**
 * Whether anything was chosen. A first save without one would store only the
 * column defaults and tick Voice off on the setup checklist, which counts a
 * saved row as done, although no voice was set. The Voice form checks this to
 * say so before saving, and the save action checks it again for every other
 * caller.
 */
export function hasVoiceChoice(choices: VoiceChoices): boolean {
  return Boolean(
    choices.derivedStyleRubric?.trim() ||
      choices.rawSamplesText?.trim() ||
      choices.tone ||
      choices.perspective ||
      choices.emojiPolicy ||
      choices.hashtagPolicy ||
      choices.formality !== undefined ||
      choices.directness !== undefined
  )
}

export const NO_VOICE_CHOICE_MESSAGE =
  'Choose at least one voice setting before saving.'
