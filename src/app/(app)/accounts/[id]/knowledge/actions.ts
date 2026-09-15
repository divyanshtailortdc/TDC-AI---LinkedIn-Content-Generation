'use server'

import { db } from '@/db'
import { knowledgeDocumentsTable } from '@/db/schema'
import { scrapeUrl } from '@/lib/scraper'
import { extractKnowledgeClaims } from '@/lib/ai/knowledge-extractor'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export async function fetchUrlPreview(url: string) {
  try {
    const scraped = await scrapeUrl(url)
    return {
      success: true,
      title: scraped.title,
      content: scraped.content,
      wordCount: scraped.wordCount,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to fetch and extract URL',
    }
  }
}

export async function saveKnowledgeDocument(payload: {
  accountId: string
  title: string
  sourceType: 'url' | 'artifact'
  sourceUrl?: string
  content: string
}) {
  if (!payload.title.trim() || !payload.content.trim()) {
    throw new Error('Title and content are required')
  }

  // Extract summary and verified claims
  const extraction = await extractKnowledgeClaims(payload.title, payload.content)

  // Store summary and claims in the summary column as structured JSON
  const summaryPayload = JSON.stringify({
    summaryText: extraction.summary,
    claims: extraction.claims,
  })

  const [inserted] = await db
    .insert(knowledgeDocumentsTable)
    .values({
      accountId: payload.accountId,
      title: payload.title.trim(),
      sourceType: payload.sourceType,
      sourceUrl: payload.sourceUrl || null,
      content: payload.content.trim(),
      summary: summaryPayload,
    })
    .returning()

  revalidatePath(`/accounts/${payload.accountId}/knowledge`)
  revalidatePath(`/accounts/${payload.accountId}`)
  revalidatePath('/accounts')
  revalidatePath('/')
  return { success: true, docId: inserted?.id }
}

export async function deleteKnowledgeDocument(docId: string, accountId: string) {
  await db
    .delete(knowledgeDocumentsTable)
    .where(
      and(
        eq(knowledgeDocumentsTable.id, docId),
        eq(knowledgeDocumentsTable.accountId, accountId)
      )
    )

  revalidatePath(`/accounts/${accountId}/knowledge`)
  revalidatePath(`/accounts/${accountId}`)
  revalidatePath('/accounts')
  revalidatePath('/')
  return { success: true }
}
