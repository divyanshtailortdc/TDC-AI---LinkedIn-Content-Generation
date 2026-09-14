import { env } from '@/env'

export type KeyClaim = {
  claim: string
  quote: string
}

export type KnowledgeExtractionResult = {
  summary: string
  claims: KeyClaim[]
}

export async function extractKnowledgeClaims(
  title: string,
  content: string
): Promise<KnowledgeExtractionResult> {
  const truncatedContent = content.slice(0, 15000)

  // 1. Try Vercel AI Gateway if key is present
  if (env.AI_GATEWAY_API_KEY) {
    try {
      const response = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'anthropic/claude-3-5-haiku',
          messages: [
            {
              role: 'system',
              content: 'You are a precise research analyst extracting verified factual claims with verbatim quotes for a knowledge base. Always respond with strict JSON.',
            },
            {
              role: 'user',
              content: `Analyze this document:
Title: ${title}
Content:
${truncatedContent}

Provide:
1. "summary": A concise 2-sentence summary of the core thesis.
2. "claims": An array of 3 to 7 verified key claims, where each object has:
   - "claim": A clear 1-sentence statement of the claim.
   - "quote": An exact verbatim supporting quote from the text.

Respond ONLY with valid JSON:
{
  "summary": "...",
  "claims": [
    { "claim": "...", "quote": "..." }
  ]
}`,
            },
          ],
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const textContent = data.choices?.[0]?.message?.content
        if (textContent) {
          const match = textContent.match(/\{[\s\S]*\}/)
          if (match) {
            const parsed = JSON.parse(match[0]) as KnowledgeExtractionResult
            if (parsed.summary && Array.isArray(parsed.claims)) {
              return parsed
            }
          }
        }
      }
    } catch (err) {
      console.warn('AI Gateway knowledge extraction failed, trying direct provider:', err)
    }
  }

  // 2. Try Anthropic directly if key is present
  if (env.ANTHROPIC_API_KEY) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1500,
          messages: [
            {
              role: 'user',
              content: `Analyze this document for a LinkedIn knowledge base.
Provide:
1. A concise 2-sentence summary of the core thesis.
2. 3 to 7 verified key claims, where every single claim has an exact verbatim supporting quote from the text.

Title: ${title}
Content:
${truncatedContent}

Respond ONLY with valid JSON:
{
  "summary": string,
  "claims": [
    {
      "claim": string,
      "quote": string
    }
  ]
}`,
            },
          ],
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const textContent = data.content?.[0]?.text
        if (textContent) {
          const match = textContent.match(/\{[\s\S]*\}/)
          if (match) {
            const parsed = JSON.parse(match[0]) as KnowledgeExtractionResult
            if (parsed.summary && Array.isArray(parsed.claims)) {
              return parsed
            }
          }
        }
      }
    } catch (err) {
      console.warn('Anthropic API knowledge extraction failed, using heuristic:', err)
    }
  }

  // 3. Fallback Heuristic Claim Extractor: extracts real quotes and metric-backed sentences
  const sentences = content
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25 && s.length < 350)

  const metricSentences = sentences.filter((s) =>
    /(\d+%|\$\d+|\b(increased|decreased|reduced|achieved|doubled|tripled|grew|scale|million|billion|faster|roi)\b)/i.test(
      s
    )
  )

  const selectedQuotes = (metricSentences.length >= 3 ? metricSentences : sentences).slice(0, 5)

  const claims: KeyClaim[] = selectedQuotes.map((quote) => ({
    claim: quote.length > 90 ? `${quote.slice(0, 87)}...` : quote,
    quote,
  }))

  const summary = sentences.slice(0, 2).join(' ') || `${title}: Key findings and operational insights.`

  return {
    summary,
    claims: claims.length > 0 ? claims : [{ claim: 'Core concept documented', quote: sentences[0] || title }],
  }
}
