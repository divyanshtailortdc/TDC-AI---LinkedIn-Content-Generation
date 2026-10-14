'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '~/db'
import { samplePostsTable, voiceConfigsTable } from '~/db/schema'
import { analyzeVoiceSamples } from '~/lib/ai/voice'

// Every voice field is optional so a voice can be saved without an analysis.
// A field left out keeps its saved value (or the column default on a new
// profile); see orNull for how text fields are cleared.
const saveVoiceSchema = z.object({
  accountId: z.string().uuid('Invalid account identifier'),
  derivedStyleRubric: z.string().trim().optional(),
  rawSamplesText: z.string().optional(),
  tone: z.string().trim().min(1).max(50).optional(),
  formality: z.coerce
    .number()
    .int()
    .min(1, 'Formality must be between 1 and 5')
    .max(5, 'Formality must be between 1 and 5')
    .optional(),
  directness: z.coerce
    .number()
    .int()
    .min(1, 'Directness must be between 1 and 5')
    .max(5, 'Directness must be between 1 and 5')
    .optional(),
  perspective: z
    .string()
    .min(1, 'Please select a Perspective (e.g. I or We)')
    .optional(),
  emojiPolicy: z.string().trim().min(1).max(30).optional(),
  hashtagPolicy: z.string().trim().min(1).max(100).optional(),
  bannedWords: z.array(z.string()).optional()
})

export type SaveVoiceInput = z.infer<typeof saveVoiceSchema>

/** Left out keeps the saved value; sent empty clears it. */
const orNull = (value?: string) => (value === undefined ? undefined : value || null)

/** Replaces the account's sample posts with the posts in the pasted text. */
async function replaceSamplePosts(accountId: string, rawSamplesText?: string) {
  if (!rawSamplesText || rawSamplesText.trim().length === 0) return

  const splitPosts = rawSamplesText
    .split(/\n\s*---\s*\n|\n\s*===\s*\n|\n\s*_{3,}\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 20)

  if (splitPosts.length === 0) return

  // Clear previous sample posts for this account to keep clean
  await db.delete(samplePostsTable).where(eq(samplePostsTable.accountId, accountId))

  // Insert extracted sample posts, detecting posts marked performed well
  for (let i = 0; i < splitPosts.length; i++) {
    const rawPost = splitPosts[i]
    if (!rawPost) continue

    const isHighPerformer =
      /\[(performed\s*well|top\s*post|high\s*performing|viral)\]|⭐/i.test(
        rawPost
      )
    const cleanContent = rawPost
      .replace(
        /\[(performed\s*well|top\s*post|high\s*performing|viral)\]|⭐/gi,
        ''
      )
      .trim()

    await db.insert(samplePostsTable).values({
      accountId,
      content: cleanContent,
      performedWell: isHighPerformer || i === 0, // Flag explicitly tagged or first post
      isActive: true
    })
  }
}

function revalidateVoicePaths(accountId: string) {
  revalidatePath(`/accounts/${accountId}`)
  revalidatePath(`/accounts/${accountId}/voice`)
  revalidatePath('/accounts')
  revalidatePath('/')
}

export async function analyzeVoiceAction(samplesText: string) {
  try {
    const analysis = await analyzeVoiceSamples(samplesText)
    return {
      success: true,
      data: analysis.result,
      provider: analysis.provider,
      modelUsed: analysis.modelUsed
    }
  } catch (error: any) {
    console.error('Error analyzing voice:', error)
    return {
      success: false,
      error: error.message || 'Failed to analyze voice samples'
    }
  }
}

export async function saveVoiceConfigAction(data: SaveVoiceInput) {
  try {
    // 1. Strict validation of payload with human-readable error messages
    const parsed = saveVoiceSchema.safeParse(data)
    if (!parsed.success) {
      const errorMsg = parsed.error.issues
        .map(issue => issue.message)
        .join('. ')
      return {
        success: false,
        error: errorMsg || 'Invalid voice configuration'
      }
    }
    const validated = parsed.data

    // 2. Clean banned words
    const sanitizedBannedWords =
      validated.bannedWords &&
      Array.from(
        new Set(
          validated.bannedWords
            .map(w => w.trim().toLowerCase())
            .filter(w => w.length > 2)
        )
      )

    // 3. Check if voice config already exists for this account
    const existing = await db.query.voiceConfigsTable.findFirst({
      where: eq(voiceConfigsTable.accountId, validated.accountId)
    })

    if (existing) {
      await db
        .update(voiceConfigsTable)
        .set({
          derivedStyleRubric: orNull(validated.derivedStyleRubric),
          rawSamplesText: orNull(validated.rawSamplesText),
          tone: validated.tone,
          formality: validated.formality,
          directness: validated.directness,
          perspective: validated.perspective,
          emojiPolicy: validated.emojiPolicy,
          hashtagPolicy: validated.hashtagPolicy,
          bannedWords: sanitizedBannedWords,
          updatedAt: new Date()
        })
        .where(eq(voiceConfigsTable.id, existing.id))
    } else {
      await db.insert(voiceConfigsTable).values({
        accountId: validated.accountId,
        derivedStyleRubric: orNull(validated.derivedStyleRubric),
        rawSamplesText: orNull(validated.rawSamplesText),
        tone: validated.tone,
        formality: validated.formality,
        directness: validated.directness,
        perspective: validated.perspective,
        emojiPolicy: validated.emojiPolicy,
        hashtagPolicy: validated.hashtagPolicy,
        bannedWords: sanitizedBannedWords
      })
    }

    // 4. If raw sample posts are provided, store individual posts into sample_posts table
    await replaceSamplePosts(validated.accountId, validated.rawSamplesText)

    revalidateVoicePaths(validated.accountId)

    return { success: true }
  } catch (error: any) {
    console.error('Error saving voice config:', error)
    let errorMessage = 'Failed to save voice profile'
    if (error instanceof z.ZodError) {
      errorMessage = error.issues.map(i => i.message).join('. ')
    } else if (typeof error?.message === 'string') {
      if (
        error.message.trim().startsWith('[') &&
        error.message.includes('"message"')
      ) {
        try {
          const parsed = JSON.parse(error.message)
          if (Array.isArray(parsed)) {
            errorMessage = parsed
              .map(item => item.message)
              .filter(Boolean)
              .join('. ')
          }
        } catch {
          errorMessage = error.message
        }
      } else {
        errorMessage = error.message
      }
    }
    return {
      success: false,
      error: errorMessage
    }
  }
}
