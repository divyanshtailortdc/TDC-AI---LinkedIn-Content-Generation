import {
  DocsSearchUnavailableError,
  searchDocsByMeaning
} from '@/docs/semantic-search'
import { AiSpendLimitError, withAiSpend } from '@/lib/ai/spend'
import { getIdentity } from '@/lib/identity'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'

/**
 * Docs search by meaning, for a question typed in the docs search
 * (src/docs/components/docs-search.tsx). The help pages are public, but
 * this embeds the question, which costs, so it is for signed-in users and
 * charged to them (source 'help'); signed out, the search works by words.
 */

const bodySchema = z.object({
  query: z.string().trim().min(3).max(200)
})

function fail(status: number, error: string) {
  return Response.json({ error }, { status })
}

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return fail(401, 'Sign in to search by meaning.')

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return fail(400, 'Type at least three characters.')

  // Charged to the identity being worked on, like other AI work, so it
  // shows in that identity's usage; the user's limits cover it either way.
  const identity = await getIdentity()

  try {
    const results = await withAiSpend(
      { source: 'help', userId: user.id, accountId: identity?.id ?? null },
      () => searchDocsByMeaning(body.data.query)
    )
    return Response.json({ results })
  } catch (error) {
    if (error instanceof DocsSearchUnavailableError)
      return fail(503, error.message)
    if (error instanceof AiSpendLimitError) return fail(429, error.message)
    console.error('Docs search by meaning failed:', error)
    return fail(502, 'Could not search by meaning just now.')
  }
}
