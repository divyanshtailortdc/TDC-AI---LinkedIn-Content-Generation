import { generateObject } from 'ai'
import { getLanguageModel } from '@/lib/ai'
import {
  VoiceAnalysisResult,
  VoiceAnalysisSchema,
  sanitizeVoiceAnalysis
} from './schemas'

/**
 * Heuristic linguistic analyzer used as an offline baseline when no AI key is configured.
 */
function analyzeHeuristically(text: string): VoiceAnalysisResult {
  const lower = text.toLowerCase()
  const words = text.trim().split(/\s+/).filter(Boolean)
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  const lines = text.split(/\n+/).filter((l) => l.trim().length > 0)

  // Perspective
  const iCount = (text.match(/\b(I|me|my|mine)\b/gi) || []).length
  const weCount = (text.match(/\b(we|us|our|ours)\b/gi) || []).length
  const perspective = iCount >= weCount ? 'I' : 'we'

  // Emojis
  const emojiCount = (
    text.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu) || []
  ).length
  let emojiPolicy: 'none' | 'bullets only' | 'liberal' = 'none'
  if (emojiCount > 8) emojiPolicy = 'liberal'
  else if (emojiCount > 0) emojiPolicy = 'bullets only'

  // Formality & Directness
  const avgSentenceLength = words.length / Math.max(1, sentences.length)
  const formality = avgSentenceLength > 18 ? 4 : avgSentenceLength < 10 ? 2 : 3
  const directness = lines.length > 5 ? 4 : 3
  const warmth =
    (lower.match(/\b(love|thank|grateful|feel|friend|people|happy|proud)\b/g) ||
      []).length > 2
      ? 4
      : 3

  // Story vs Data
  const numberCount = (text.match(/\b\d+(\.\d+)?%?\b/g) || []).length
  const storyVsData = numberCount > 5 ? 4 : numberCount > 1 ? 3 : 2

  // Hashtags
  const hashtagCount = (text.match(/#[a-z0-9_]+/gi) || []).length
  const hashtagPolicy =
    hashtagCount === 0
      ? 'none'
      : hashtagCount <= 3
        ? '0-3, end of post'
        : '3-5, end of post'

  // Paragraph style
  const paragraphStyle =
    lines.length / Math.max(1, sentences.length) > 0.7
      ? 'short paras'
      : 'single-line breaks'

  // Detect writing patterns heuristically
  const writingPatterns: string[] = []
  if (/you do not need|you don't need/i.test(text)) {
    writingPatterns.push("You don't need X. You need Y.")
  }
  if (/is not the|isn't the.*is/i.test(text)) {
    writingPatterns.push("X isn't the problem. Y is.")
  }
  if (/blame creates|creates/i.test(text)) {
    writingPatterns.push('A creates B. C creates D.')
  }
  if (writingPatterns.length === 0) {
    writingPatterns.push('Direct contrast: Problem assertion -> Concrete operational reality.')
  }

  // Detect signature phrases (exclude generic fragments)
  const signaturePhrases: string[] = []
  if (/net revenue retention/i.test(text)) signaturePhrases.push('Net revenue retention')
  if (/before making/i.test(text)) signaturePhrases.push('before making a single dollar')
  if (/uncomfortable truth/i.test(text)) signaturePhrases.push('Here is an uncomfortable truth:')
  if (signaturePhrases.length === 0) {
    signaturePhrases.push('The real takeaway:', 'Bottom line:')
  }

  const rawResult: VoiceAnalysisResult = {
    derivedStyleRubric:
      'Opens with a concrete scene or number, never an unearned claim. Short paragraphs with one idea each, using staccato rhythm and high whitespace. Closes on a philosophical question or practical takeaway, never hard engagement bait. Avoids corporate buzzwords like "delve", "leverage", and "game-changer".',
    writingPatterns,
    tone: 'candid',
    formality,
    warmth,
    directness,
    humor: 'dry',
    energy: 'measured',
    perspective,
    storyVsData,
    emojiPolicy,
    hashtagPolicy,
    sentenceLength: avgSentenceLength < 12 ? 'short' : 'mixed',
    paragraphStyle,
    readingLevelTarget: 'grade 7-9',
    bannedWords: [
      'delve',
      'leverage',
      'unlock',
      'game-changer',
      'revolutionary',
      'synergy',
      "in today's fast-paced world",
      "I'm thrilled to announce"
    ],
    signaturePhrases,
    openingStyles: [
      'Concrete timeline or financial metric scene',
      'Direct counter-intuitive observation'
    ],
    closingStyles: [
      'Reflective inquiry without engagement bait',
      'Concise imperative rule'
    ],
    rules: `Writing Patterns:\n${writingPatterns.map((p) => `- ${p}`).join('\n')}`
  }

  return sanitizeVoiceAnalysis(rawResult)
}

/**
 * Prepares and formats raw sample posts for Claude, highlighting posts marked as high-performing.
 */
function prepareSamplesPrompt(rawText: string): string {
  const rawPosts = rawText
    .split(/\n\s*---\s*\n|\n\s*===\s*\n|\n\s*_{3,}\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 10)

  if (rawPosts.length === 0) {
    return rawText.trim()
  }

  return rawPosts
    .map((post, idx) => {
      const isHighPerformer =
        /\[(performed\s*well|top\s*post|high\s*performing|viral)\]|⭐/i.test(
          post
        )
      const cleanPost = post
        .replace(
          /\[(performed\s*well|top\s*post|high\s*performing|viral)\]|⭐/gi,
          ''
        )
        .trim()

      return `--- Post Sample #${idx + 1}${
        isHighPerformer
          ? ' [FLAGGED: PERFORMED EXCEPTIONALLY WELL — USE AS STRONGER EVIDENCE FOR HOOKS & PACING]'
          : ''
      } ---\n${cleanPost}`
    })
    .join('\n\n')
}

/**
 * Analyzes pasted sample posts using Claude (via Vercel AI Gateway or direct Anthropic).
 */
export async function analyzeVoiceSamples(samplesText: string): Promise<{
  result: VoiceAnalysisResult
  provider: 'claude' | 'heuristic'
  modelUsed?: string
}> {
  const cleanText = samplesText.trim()
  if (!cleanText) {
    throw new Error('Please paste at least one sample post to analyze.')
  }

  const aiInstance = getLanguageModel('voice_analysis')

  if (!aiInstance) {
    return {
      result: analyzeHeuristically(cleanText),
      provider: 'heuristic'
    }
  }

  const formattedPrompt = prepareSamplesPrompt(cleanText)

  try {
    const { object } = await generateObject({
      model: aiInstance.model,
      providerOptions: aiInstance.providerOptions,
      schema: VoiceAnalysisSchema,
      instructions: `You are an elite editorial writing coach, speechwriter, and linguistic analyst specializing in LinkedIn thought leadership.
Your job is to analyze real past LinkedIn posts from an author and extract an actionable, highly accurate Voice Profile.

CRITICAL EDITORIAL RULES:
1. SIGNATURE PHRASES:
   - Extract only genuinely DISTINCTIVE phrases, trademark transitions, punchy mantras, or recurring conceptual formulations unique to this author (e.g. "The real takeaway:", "Don't abandon your core audience", "Here is what happened:").
   - STRICTLY AVOID generic grammatical fragments or common filler like "So I", "It doesn't", "That's why", "In other words", "I think", "Here are".

2. REUSABLE WRITING PATTERNS:
   - Identify recurring syntactic contrast structures and rhetorical templates used by the author, such as:
     * "X isn't the problem. Y is."
     * "You don't need X. You need Y."
     * "A creates B. C creates D."
     * "Most people do X. We did Y."
   - Explicitly extract these into writingPatterns and weave them into the derivedStyleRubric and rules so subsequent post generation replicates the author's argument cadence.

3. BANNED WORDS (ANTI-PATTERNS):
   - Do NOT mark a word as banned simply because it was not present in the sample posts.
   - Only identify corporate buzzwords, hollow marketing hype, or cliches that are STRONGLY INCONSISTENT with this author's specific tone (e.g. if the author writes crisp, pragmatic engineering posts, flag words like "delve", "leverage", "synergy", "game-changer", "revolutionary", "in today's fast-paced world", "I'm thrilled to announce" that clash with their voice). Limit to 4-8 high-confidence anti-patterns.

4. HIGH-PERFORMING POSTS:
   - Pay special attention to any posts marked [PERFORMED EXCEPTIONALLY WELL]. These indicate hook mechanics, pacing, and line-break structures that resonated most strongly with the audience. Weigh their formatting and argument progression more heavily, but do not overfit to their specific topical subject matter.

5. OPENING & CLOSING STYLES:
   - Describe the ACTUAL patterns found in these specific samples (e.g. "Concrete dollar metric + timeframe scene", "Three consecutive short negations", "Imperative command without question") rather than generic textbook labels like "question" or "bold claim".

6. DERIVED STYLE RUBRIC:
   - Write a sharp, 3-4 sentence comprehensive guide that another LLM can read as a system prompt to write indistinguishably like this author. It must specify:
     * Hook mechanic (how the first 1-2 lines draw the reader before the fold)
     * Body cadence and white-space structure
     * Syntactic contrast patterns
     * Emotional tone and closing convention`,
      prompt: `Here are real sample posts from the author:

${formattedPrompt}

Analyze their writing voice across all dimensions with surgical precision.`
    })

    // Validate and sanitize the response to enforce all constraints
    const sanitized = sanitizeVoiceAnalysis(object)

    return {
      result: sanitized,
      provider: 'claude',
      modelUsed: `${aiInstance.providerName} (${aiInstance.modelId})`
    }
  } catch (error) {
    console.warn(
      'AI call failed, falling back to heuristic voice analyzer:',
      error
    )
    return {
      result: analyzeHeuristically(cleanText),
      provider: 'heuristic'
    }
  }
}
