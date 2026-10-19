'use server'

import { db } from '@/db'
import { knowledgeDocumentsTable } from '@/db/schema'
import { requireOwnedAccount } from '@/lib/account-guard'
import { indexKnowledgeDocument } from '@/lib/ai/embeddings'
import { extractKnowledgeClaims } from '@/lib/ai/skills/knowledge-extraction'
import { IDENTITY_PATH } from '@/lib/identity'
import { idSchema } from '@/lib/ids'
import { looksLikePlaceholderPage, scrapeUrl } from '@/lib/scraper'
import { requireUser } from '@/lib/session'
import {
  AccountIdSchema,
  KnowledgeDocumentSchema,
  parseSetupPayload
} from '@/lib/setup-payloads'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export async function fetchUrlPreview(url: string) {
  // Signed-in only: it makes this server fetch an arbitrary public URL.
  await requireUser()
  try {
    const scraped = await scrapeUrl(url)

    if (looksLikePlaceholderPage(scraped.title, scraped.content)) {
      return {
        success: false,
        error:
          'That URL returned an error or placeholder page rather than an article. Check the link, or paste the text in as an artifact instead.'
      }
    }

    return {
      success: true,
      title: scraped.title,
      content: scraped.content,
      wordCount: scraped.wordCount
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to fetch and extract URL'
    }
  }
}

export async function saveKnowledgeDocument(rawPayload: {
  accountId: string
  title: string
  sourceType: 'url' | 'artifact'
  sourceUrl?: string
  content: string
}) {
  const user = await requireUser()
  const payload = parseSetupPayload(KnowledgeDocumentSchema, rawPayload)
  await requireOwnedAccount(user.id, payload.accountId)
  if (!payload.title.trim() || !payload.content.trim()) {
    throw new Error('Title and content are required')
  }

  // Extract summary and verified claims
  const extraction = await extractKnowledgeClaims(
    payload.title,
    payload.content
  )
  const content = payload.content.trim()

  const [inserted] = await db
    .insert(knowledgeDocumentsTable)
    .values({
      accountId: payload.accountId,
      title: payload.title.trim(),
      sourceType: payload.sourceType,
      sourceUrl: payload.sourceUrl || null,
      content,
      summary: extraction.summary,
      topics: extraction.topics,
      keyClaims: extraction.claims,
      wordCount: content.split(/\s+/).filter(Boolean).length
    })
    .returning()

  if (inserted) {
    try {
      await indexKnowledgeDocument(inserted)
    } catch (err) {
      console.warn(`Could not embed knowledge document ${inserted.id}:`, err)
    }
  }

  revalidatePath(`${IDENTITY_PATH}/knowledge`)
  revalidatePath(IDENTITY_PATH)
  revalidatePath('/')
  return { success: true, docId: inserted?.id }
}

const DocumentIdSchema = idSchema('Invalid document identifier')

export async function deleteKnowledgeDocument(
  rawDocId: string,
  rawAccountId: string
) {
  const user = await requireUser()
  const docId = parseSetupPayload(DocumentIdSchema, rawDocId)
  const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
  // The document is then matched on both ids, so only this identity's is deleted.
  await requireOwnedAccount(user.id, accountId)
  await db
    .delete(knowledgeDocumentsTable)
    .where(
      and(
        eq(knowledgeDocumentsTable.id, docId),
        eq(knowledgeDocumentsTable.accountId, accountId)
      )
    )

  revalidatePath(`${IDENTITY_PATH}/knowledge`)
  revalidatePath(IDENTITY_PATH)
  revalidatePath('/')
  return { success: true }
}
