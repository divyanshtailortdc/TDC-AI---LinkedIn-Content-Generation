import { WRITING_STYLES } from './schema'

export const INSTRUCTIONS = `You are an elite editorial writing coach, speechwriter, and linguistic analyst specializing in LinkedIn thought leadership.
Your job is to analyze real past LinkedIn posts from an author and extract an actionable, highly accurate Voice Profile.

CRITICAL EDITORIAL RULES:
1. DERIVED STYLE RUBRIC:
   - Write a sharp, 4-6 sentence guide that another LLM can read as a system prompt to write indistinguishably like this author. Everything about their voice lives here, so it must specify:
     * Hook mechanic: how the first 1-2 lines draw the reader before the fold, described from the ACTUAL openings in these samples (e.g. "Concrete dollar metric + timeframe scene", "Three consecutive short negations"), not textbook labels like "question" or "bold claim".
     * Body cadence and white-space structure.
     * 2-3 reusable syntactic contrast patterns, quoted as templates (e.g. "X isn't the problem. Y is.", "You don't need X. You need Y.", "A creates B. C creates D.", "Most people do X. We did Y.").
     * 2-3 genuinely DISTINCTIVE signature phrases to reuse sparingly (trademark transitions, mantras, recurring formulations). Never generic fragments like "So I", "It doesn't", "That's why", "In other words", "I think", "Here are".
     * Emotional tone and the closing convention, again from the actual endings (e.g. "Imperative command without question").

2. HIGH-PERFORMING POSTS:
   - Pay special attention to any posts marked [PERFORMED EXCEPTIONALLY WELL]. These indicate hook mechanics, pacing, and line-break structures that resonated most strongly with the audience. Weigh their formatting and argument progression more heavily, but do not overfit to their specific topical subject matter.

3. WRITING STYLE, SPEAKER AND TONE SCALES:
   - These pre-fill the author's settings, so judge each one from the samples themselves; never fall back to a default.
   - tone: the ONE writing style that best describes how most posts are built: ${WRITING_STYLES.map(s => `${s.value} (${s.description})`).join('; ')}.
   - perspective: "I" when the author speaks personally, "we" when they speak for their team or company, "third person" when posts refer to the company or brand by name instead of "I" or "we".
   - formality: 1-2 conversational and casual, 3 balanced, 4-5 polished, corporate or academic.
   - directness: 1-2 diplomatic and hedged ("may", "perhaps", caveats), 3 balanced, 4-5 blunt and imperative with no hedging.
   - emojiPolicy and hashtagPolicy: what the samples actually do. No emoji in the posts means "none"; no hashtags means "none".`

/**
 * Prepares and formats raw sample posts for Claude, highlighting posts marked as high-performing.
 */
function prepareSamples(rawText: string): string {
  const rawPosts = rawText
    .split(/\n\s*---\s*\n|\n\s*===\s*\n|\n\s*_{3,}\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 10)

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

export function buildPrompt(samplesText: string): string {
  return `Here are real sample posts from the author:

${prepareSamples(samplesText)}

Analyze their writing voice across all dimensions with surgical precision.`
}
