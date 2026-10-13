'use server'

import { db } from '@/db'
import { accountsTable, audiencesTable, offeringsTable } from '@/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

const offeringSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Offering name is required'),
  type: z.string().default('service'),
  tagline: z.string().optional(),
  description: z.string().optional(),
  url: z.string().url().optional().or(z.literal(''))
})

const audienceSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Audience name is required'),
  painPoints: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([])
})

function extractAndSanitizeHandle(
  rawInput: string | null | undefined,
  nameFallback: string = ''
): string {
  let cleaned = (rawInput || '').trim()

  // Extract handle if user pasted full LinkedIn URL (e.g. linkedin.com/in/aditya-kumar-376474235 or linkedin.com/company/acme)
  const linkedinMatch = cleaned.match(
    /(?:linkedin\.com\/(?:in|company)\/)([^/?#]+)/i
  )
  if (linkedinMatch && linkedinMatch[1]) {
    cleaned = linkedinMatch[1]
  }

  // Remove URL scheme or slashes if user typed https://...
  cleaned = cleaned.replace(/^https?:\/\//i, '').replace(/^www\./i, '')

  // Fallback to name if empty
  if (!cleaned) {
    cleaned = nameFallback.trim()
  }

  // Convert to clean URL slug
  const slug = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'identity'
}

const createAccountSchema = z.object({
  name: z.string().trim().min(1, 'Display name is required'),
  company: z.string().trim().optional(),
  description: z.string().trim().min(1, 'Description is required'),
  targetAudience: z.string().trim().min(1, 'Target audience is required'),
  offerings: z.string().trim().min(1, 'Offerings are required'),
  industry: z.string().trim().min(1, 'Industry is required'),
  linkedinUrl: z.string().trim().optional(),
  websiteUrl: z.string().trim().optional()
})

const updateAccountSchema = z.object({
  id: z.string().uuid('Invalid account identifier'),
  name: z.string().trim().min(1, 'Display name is required'),
  accountType: z.enum(['personal', 'company']),
  handle: z.string().trim().min(1, 'LinkedIn handle is required'),
  headline: z.string().trim().min(1, 'Headline is required'),
  bio: z.string().optional(),
  avatarUrl: z.string().trim().optional().or(z.literal('')),
  company: z.string().optional(),
  websiteUrl: z.string().trim().optional().or(z.literal('')),
  offerings: z.array(offeringSchema).optional(),
  audiences: z.array(audienceSchema).optional()
})

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>

export async function createAccount(formData: FormData) {
  const field = (key: string) => (formData.get(key) as string) || ''

  const parsed = createAccountSchema.safeParse({
    name: field('name'),
    company: field('company') || undefined,
    description: field('description'),
    targetAudience: field('targetAudience'),
    offerings: field('offerings'),
    industry: field('industry'),
    linkedinUrl: field('linkedinUrl') || undefined,
    websiteUrl: field('websiteUrl') || undefined
  })
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(i => i.message).join(', '))
  }
  const data = parsed.data

  // The handle is derived from the LinkedIn URL (falling back to the name) and
  // deduplicated against existing accounts to prevent a unique constraint crash.
  const baseHandle = extractAndSanitizeHandle(data.linkedinUrl, data.name)
  let candidateHandle = baseHandle
  let counter = 1
  while (true) {
    const existing = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.handle, candidateHandle)
    })
    if (!existing) {
      break
    }
    counter++
    candidateHandle = `${baseHandle}-${counter}`
  }

  const accountValues = (handle: string) => ({
    name: data.name,
    accountType: data.company ? ('company' as const) : ('personal' as const),
    handle,
    // headline is required by the schema; build it from the fields we collect
    headline: [data.company, data.industry].filter(Boolean).join(' · '),
    bio: data.description,
    company: data.company || null,
    industry: data.industry,
    linkedinUrl: data.linkedinUrl || null,
    websiteUrl: data.websiteUrl || null
  })

  // Insert account with fallback handling for race conditions
  let account: typeof accountsTable.$inferSelect | undefined
  try {
    const [inserted] = await db
      .insert(accountsTable)
      .values(accountValues(candidateHandle))
      .returning()
    account = inserted
  } catch (err: any) {
    // If unique constraint violation occurs concurrently, append a unique suffix
    if (err?.code === '23505' || err?.cause?.code === '23505') {
      const fallbackHandle = `${candidateHandle}-${Date.now().toString(36)}`
      const [inserted] = await db
        .insert(accountsTable)
        .values(accountValues(fallbackHandle))
        .returning()
      account = inserted
    } else {
      throw err
    }
  }

  if (!account) throw new Error('Failed to create account')

  // The form collects offerings and audience as free text, stored as one row each.
  const firstLine = data.offerings.split('\n')[0]?.trim() ?? ''
  await db.insert(offeringsTable).values({
    accountId: account.id,
    name: firstLine.slice(0, 80) || 'Offerings',
    description: data.offerings,
    isActive: true
  })

  await db.insert(audiencesTable).values({
    accountId: account.id,
    name: data.targetAudience
  })

  revalidatePath('/')
  revalidatePath('/accounts')
  redirect(`/accounts/${account.id}`)
}

export async function updateAccountAction(input: UpdateAccountInput) {
  try {
    const rawHandle = extractAndSanitizeHandle(input.handle, input.name)
    const parsed = updateAccountSchema.safeParse({
      ...input,
      handle: rawHandle
    })

    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues.map(i => i.message).join('. ')
      }
    }

    const validated = parsed.data

    // 1. Verify account exists
    const existing = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, validated.id)
    })
    if (!existing) {
      return { success: false, error: 'Account identity not found' }
    }

    // 2. Check if handle is already taken by another account
    const handleConflict = await db.query.accountsTable.findFirst({
      where: and(
        eq(accountsTable.handle, validated.handle),
        ne(accountsTable.id, validated.id)
      )
    })
    if (handleConflict) {
      return {
        success: false,
        error: `LinkedIn handle "${validated.handle}" is already in use by another identity.`
      }
    }

    // 3. Update core identity
    await db
      .update(accountsTable)
      .set({
        name: validated.name,
        accountType: validated.accountType,
        handle: validated.handle,
        headline: validated.headline,
        bio: validated.bio?.trim() || null,
        avatarUrl: validated.avatarUrl?.trim() || null,
        company: validated.company?.trim() || null,
        websiteUrl: validated.websiteUrl?.trim() || null,
        updatedAt: new Date()
      })
      .where(eq(accountsTable.id, validated.id))

    // 4. Synchronize Offerings (only if explicitly provided)
    if (validated.offerings !== undefined) {
      await db
        .delete(offeringsTable)
        .where(eq(offeringsTable.accountId, validated.id))

      if (validated.offerings.length > 0) {
        const cleanOfferings = validated.offerings
          .filter(o => o.name.trim().length > 0)
          .map(o => ({
            accountId: validated.id,
            name: o.name.trim(),
            type: o.type || 'service',
            tagline: o.tagline?.trim() || null,
            description: o.description?.trim() || null,
            url: o.url?.trim() || null,
            isActive: true
          }))

        if (cleanOfferings.length > 0) {
          await db.insert(offeringsTable).values(cleanOfferings)
        }
      }
    }

    // 5. Synchronize Target Audiences (only if explicitly provided)
    if (validated.audiences !== undefined) {
      await db
        .delete(audiencesTable)
        .where(eq(audiencesTable.accountId, validated.id))

      if (validated.audiences.length > 0) {
        const cleanAudiences = validated.audiences
          .filter(a => a.name.trim().length > 0)
          .map(a => ({
            accountId: validated.id,
            name: a.name.trim(),
            painPoints: a.painPoints.map(p => p.trim()).filter(Boolean),
            goals: a.goals.map(g => g.trim()).filter(Boolean)
          }))

        if (cleanAudiences.length > 0) {
          await db.insert(audiencesTable).values(cleanAudiences)
        }
      }
    }

    // 6. Revalidate cache
    revalidatePath('/')
    revalidatePath('/accounts')
    revalidatePath(`/accounts/${validated.id}`)
    revalidatePath(`/accounts/${validated.id}/voice`)
    revalidatePath(`/accounts/${validated.id}/goals`)
    revalidatePath(`/accounts/${validated.id}/preferences`)
    revalidatePath(`/accounts/${validated.id}/knowledge`)

    return { success: true }
  } catch (error: any) {
    console.error('Error updating account identity:', error)
    return {
      success: false,
      error: error?.message || 'Failed to update identity'
    }
  }
}

export async function deleteAccountAction(accountId: string) {
  try {
    const parsed = z
      .string()
      .uuid('Invalid account identifier')
      .safeParse(accountId)
    if (!parsed.success) {
      return { success: false, error: 'Invalid account identifier' }
    }
    const id = parsed.data

    // Verify account exists
    const existing = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, id)
    })
    if (!existing) {
      return { success: false, error: 'Account identity not found' }
    }

    // Soft delete: mark identity as inactive (isActive: false)
    await db
      .update(accountsTable)
      .set({
        isActive: false,
        updatedAt: new Date()
      })
      .where(eq(accountsTable.id, id))

    // Revalidate paths
    revalidatePath('/')
    revalidatePath('/accounts')
    revalidatePath(`/accounts/${id}`)

    return { success: true }
  } catch (error: any) {
    console.error('Error deactivating account identity:', error)
    return {
      success: false,
      error: error?.message || 'Failed to deactivate identity'
    }
  }
}

export async function reactivateAccountAction(accountId: string) {
  try {
    const parsed = z
      .string()
      .uuid('Invalid account identifier')
      .safeParse(accountId)
    if (!parsed.success) {
      return { success: false, error: 'Invalid account identifier' }
    }
    const id = parsed.data

    // Verify account exists
    const existing = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, id)
    })
    if (!existing) {
      return { success: false, error: 'Account identity not found' }
    }

    // Reactivate identity (isActive: true)
    await db
      .update(accountsTable)
      .set({
        isActive: true,
        updatedAt: new Date()
      })
      .where(eq(accountsTable.id, id))

    // Revalidate paths
    revalidatePath('/')
    revalidatePath('/accounts')
    revalidatePath(`/accounts/${id}`)

    return { success: true }
  } catch (error: any) {
    console.error('Error reactivating account identity:', error)
    return {
      success: false,
      error: error?.message || 'Failed to reactivate identity'
    }
  }
}
