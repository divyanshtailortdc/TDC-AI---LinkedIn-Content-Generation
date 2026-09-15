'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '~/db'
import { samplePostsTable, voiceConfigsTable } from '~/db/schema'
import { GENERIC_PHRASE_BLACKLIST } from '~/lib/ai/schemas'
import { analyzeVoiceSamples } from '~/lib/ai/voice'

const saveVoiceSchema = z.object({
  accountId: z.string().uuid('Invalid account identifier'),
  derivedStyleRubric: z
    .string()
    .trim()
    .min(
      20,
      'Style rubric must be at least 20 characters. Please click "Analyze my voice" or write a rubric.'
    ),
  rawSamplesText: z.string().optional(),
  formality: z.coerce
    .number()
    .int()
    .min(1, 'Formality must be between 1 and 5')
    .max(5, 'Formality must be between 1 and 5'),
  warmth: z.coerce
    .number()
    .int()
    .min(1, 'Warmth must be between 1 and 5')
    .max(5, 'Warmth must be between 1 and 5'),
  directness: z.coerce
    .number()
    .int()
    .min(1, 'Directness must be between 1 and 5')
    .max(5, 'Directness must be between 1 and 5'),
  humor: z.string().min(1, 'Please select a Humor tone').default('dry'),
  energy: z
    .string()
    .min(1, 'Please select an Energy level')
    .default('measured'),
  perspective: z
    .string()
    .min(1, 'Please select a Perspective (e.g. I or We)')
    .default('I'),
  storyVsData: z.coerce
    .number()
    .int()
    .min(1, 'Story vs Data must be between 1 and 5')
    .max(5, 'Story vs Data must be between 1 and 5'),
  emojiPolicy: z.string().default('none'),
  hashtagPolicy: z.string().default('none'),
  sentenceLength: z.string().default('short'),
  paragraphStyle: z.string().default('short paras'),
  readingLevelTarget: z.string().default('grade 7-9'),
  bannedWords: z.array(z.string()).default([]),
  signaturePhrases: z.array(z.string()).default([]),
  writingPatterns: z.array(z.string()).default([]),
  openingStyles: z.array(z.string()).default([]),
  closingStyles: z.array(z.string()).default([]),
  rules: z.string().optional()
})

export type SaveVoiceInput = z.infer<typeof saveVoiceSchema>

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

    // 2. Validate and sanitize signature phrases before saving
    const sanitizedPhrases = validated.signaturePhrases
      .map(p => p.trim())
      .filter(p => {
        if (p.length < 5) return false
        const normalized = p
          .toLowerCase()
          .replace(/[^\w\s']/g, '')
          .trim()
        if (GENERIC_PHRASE_BLACKLIST.has(normalized)) return false
        if (
          /^(so\s+i|it\s+doesn't|it\s+doesnt|that's\s+why|thats\s+why|that\s+is\s+why|i\s+think|here\s+is)$/i.test(
            normalized
          )
        ) {
          return false
        }
        return true
      })

    // 3. Clean banned words
    const sanitizedBannedWords = Array.from(
      new Set(
        validated.bannedWords
          .map(w => w.trim().toLowerCase())
          .filter(w => w.length > 2)
      )
    )

    // 4. Construct rules incorporating writing patterns
    let rulesContent = validated.rules?.trim() || ''
    if (validated.writingPatterns && validated.writingPatterns.length > 0) {
      const patternsBlock = `Core Writing Patterns:\n${validated.writingPatterns.map(p => `- ${p}`).join('\n')}`
      if (rulesContent.includes('Core Writing Patterns:')) {
        rulesContent = rulesContent
          .replace(
            /Core Writing Patterns:\n[\s\S]*?(?:\n\n|$)/,
            `${patternsBlock}\n\n`
          )
          .trim()
      } else {
        rulesContent = rulesContent
          ? `${rulesContent}\n\n${patternsBlock}`
          : patternsBlock
      }
    }

    // 5. Check if voice config already exists for this account
    const existing = await db.query.voiceConfigsTable.findFirst({
      where: eq(voiceConfigsTable.accountId, validated.accountId)
    })

    if (existing) {
      await db
        .update(voiceConfigsTable)
        .set({
          derivedStyleRubric: validated.derivedStyleRubric,
          rawSamplesText: validated.rawSamplesText || null, // Keep rawSamplesText unchanged
          formality: validated.formality,
          warmth: validated.warmth,
          directness: validated.directness,
          humor: validated.humor,
          energy: validated.energy,
          perspective: validated.perspective,
          storyVsData: validated.storyVsData,
          emojiPolicy: validated.emojiPolicy,
          hashtagPolicy: validated.hashtagPolicy,
          sentenceLength: validated.sentenceLength,
          paragraphStyle: validated.paragraphStyle,
          readingLevelTarget: validated.readingLevelTarget,
          bannedWords: sanitizedBannedWords,
          signaturePhrases: sanitizedPhrases,
          openingStyles: validated.openingStyles,
          closingStyles: validated.closingStyles,
          rules: rulesContent || null,
          updatedAt: new Date()
        })
        .where(eq(voiceConfigsTable.id, existing.id))
    } else {
      await db.insert(voiceConfigsTable).values({
        accountId: validated.accountId,
        derivedStyleRubric: validated.derivedStyleRubric,
        rawSamplesText: validated.rawSamplesText || null,
        formality: validated.formality,
        warmth: validated.warmth,
        directness: validated.directness,
        humor: validated.humor,
        energy: validated.energy,
        perspective: validated.perspective,
        storyVsData: validated.storyVsData,
        emojiPolicy: validated.emojiPolicy,
        hashtagPolicy: validated.hashtagPolicy,
        sentenceLength: validated.sentenceLength,
        paragraphStyle: validated.paragraphStyle,
        readingLevelTarget: validated.readingLevelTarget,
        bannedWords: sanitizedBannedWords,
        signaturePhrases: sanitizedPhrases,
        openingStyles: validated.openingStyles,
        closingStyles: validated.closingStyles,
        rules: rulesContent || null
      })
    }

    // 6. If raw sample posts are provided, store individual posts into sample_posts table
    if (
      validated.rawSamplesText &&
      validated.rawSamplesText.trim().length > 0
    ) {
      const splitPosts = validated.rawSamplesText
        .split(/\n\s*---\s*\n|\n\s*===\s*\n|\n\s*_{3,}\s*\n/)
        .map(p => p.trim())
        .filter(p => p.length > 20)

      if (splitPosts.length > 0) {
        // Clear previous sample posts for this account to keep clean
        await db
          .delete(samplePostsTable)
          .where(eq(samplePostsTable.accountId, validated.accountId))

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
            accountId: validated.accountId,
            content: cleanContent,
            performedWell: isHighPerformer || i === 0, // Flag explicitly tagged or first post
            isActive: true
          })
        }
      }
    }

    revalidatePath(`/accounts/${validated.accountId}`)
    revalidatePath(`/accounts/${validated.accountId}/voice`)
    revalidatePath('/accounts')
    revalidatePath('/')

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
