import 'server-only'

import { isAICapable } from '@/lib/ai'
import { UnsafeUrlError } from '@/lib/safe-url'
import { looksLikePlaceholderPage, scrapeUrl } from '@/lib/scraper'
import { SkillError } from '../run-skill'
import { suggestSetup, type SetupSource } from '../skills/profile-setup'
import {
  AnalyzeIdentityInputSchema,
  hasAnySuggestion,
  type AnalyzeIdentityInput,
  type IdentitySetupAnalysis,
  type SourceFetchStatus
} from '../skills/profile-setup/schema'

/**
 * AI setup ("Describe yourself once"): fetch the pages the user named, run the
 * profile-setup skill over them, and turn failures into messages the user can
 * act on. Read-only; the review dialog decides what gets saved.
 */

/** Per-page cap on what the model sees; the scraper already caps at 50k. */
const SOURCE_PROMPT_CHARS = 8000
/** A slow website should not hold up the analysis; the description is enough. */
const SOURCE_FETCH_TIMEOUT_MS = 8000
/** Past this the user is better off retrying than waiting. */

export class IdentitySetupError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'IdentitySetupError'
  }
}

/**
 * LinkedIn serves a sign-in wall to logged-out fetches, which scrapes fine but
 * says nothing about the person. Treat it as unavailable rather than as data.
 */
function looksLikeLoginWall(url: string, title: string, content: string) {
  if (!/(^|\.)linkedin\.com$/i.test(new URL(url).hostname)) return false
  const words = content.split(/\s+/).filter(Boolean).length
  return (
    /\b(sign in|sign up|log in|join now|authwall)\b/i.test(title) ||
    (words < 300 && /\b(sign in|join now|agree & join)\b/i.test(content))
  )
}

async function fetchSource(
  url: string,
  kind: SourceFetchStatus['kind']
): Promise<{ status: SourceFetchStatus; content?: string }> {
  // Logged-out requests to LinkedIn get a sign-in wall, and trying costs
  // several seconds, so the description is used instead.
  if (kind === 'linkedin') {
    return {
      status: {
        url,
        kind,
        status: 'unavailable',
        reason:
          'LinkedIn requires signing in, so your description was used instead.'
      }
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const page = await Promise.race([
      scrapeUrl(url),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('timeout')),
          SOURCE_FETCH_TIMEOUT_MS
        )
      })
    ])
    if (
      looksLikePlaceholderPage(page.title, page.content) ||
      looksLikeLoginWall(url, page.title, page.content)
    ) {
      return {
        status: {
          url,
          kind,
          status: 'unavailable',
          reason: 'The page returned an error or sign-in wall.'
        }
      }
    }
    return {
      status: { url, kind, status: 'fetched', title: page.title },
      content: page.content.slice(0, SOURCE_PROMPT_CHARS)
    }
  } catch (error) {
    return {
      status: {
        url,
        kind,
        status: 'unavailable',
        reason:
          error instanceof UnsafeUrlError
            ? error.message
            : error instanceof Error && error.message === 'timeout'
              ? 'The page took too long to load.'
              : 'The page could not be fetched.'
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function analyzeIdentitySetup(
  input: AnalyzeIdentityInput
): Promise<IdentitySetupAnalysis> {
  const parsed = AnalyzeIdentityInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new IdentitySetupError(
      parsed.error.issues.map(i => i.message).join(' '),
      false
    )
  }
  const { description, linkedinUrl, websiteUrl } = parsed.data

  // Checked before fetching so a missing key does not cost the page fetches.
  if (!isAICapable) {
    throw new IdentitySetupError(
      'AI is not configured. Set ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to use Analyze with AI.',
      false
    )
  }

  const requested: Array<[string, SourceFetchStatus['kind']]> = []
  if (linkedinUrl) requested.push([linkedinUrl, 'linkedin'])
  if (websiteUrl) requested.push([websiteUrl, 'website'])
  const sources: SetupSource[] = await Promise.all(
    requested.map(([url, kind]) => fetchSource(url, kind))
  )

  let result: Awaited<ReturnType<typeof suggestSetup>>
  try {
    result = await suggestSetup({
      description,
      sources,
      providedUrls: requested.map(([url]) => url)
    })
  } catch (error) {
    console.error('Identity setup analysis failed:', error)
    throw new IdentitySetupError(
      error instanceof SkillError && error.reason === 'timeout'
        ? 'The analysis took too long. Please try again.'
        : 'The AI could not complete the analysis. Please try again.',
      true
    )
  }

  if (!hasAnySuggestion(result.suggestions)) {
    throw new IdentitySetupError(
      'There was not enough information to suggest anything. Add more detail about who you are, who you serve and what you offer, then try again.',
      true
    )
  }

  return {
    suggestions: result.suggestions,
    warnings: result.warnings,
    sources: sources.map(s => s.status),
    modelUsed: result.modelUsed
  }
}
