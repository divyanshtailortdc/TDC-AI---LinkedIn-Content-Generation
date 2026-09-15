'use server'

import { db } from '@/db'
import {
  accountsTable,
  audiencesTable,
  feedbackTable,
  goalsTable,
  ideasTable,
  knowledgeDocumentsTable,
  offeringsTable,
  postCitationsTable,
  postDraftsTable,
  postMediaTable,
  postVariantsTable,
  preferencesTable,
  researchFindingsTable,
  runsTable,
  runStepsTable,
  samplePostsTable,
  schedulesTable,
  voiceConfigsTable
} from '@/db/schema'
import { and, eq, inArray, ne } from 'drizzle-orm'
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

const accountFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  accountType: z.enum(['personal', 'company']),
  handle: z.string().min(1, 'Handle is required'),
  headline: z.string().min(1, 'Headline is required'),
  bio: z.string().optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
  company: z.string().optional(),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  offerings: z.array(offeringSchema).default([]),
  audiences: z.array(audienceSchema).default([])
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
  let offerings: any[] = []
  let audiences: any[] = []

  try {
    const rawOfferings = formData.get('offeringsData') as string
    if (rawOfferings) {
      offerings = JSON.parse(rawOfferings)
    }
  } catch (err) {
    console.error('Error parsing offerings:', err)
  }

  try {
    const rawAudiences = formData.get('audiencesData') as string
    if (rawAudiences) {
      audiences = JSON.parse(rawAudiences)
    }
  } catch (err) {
    console.error('Error parsing audiences:', err)
  }

  const raw = {
    name: formData.get('name') as string,
    accountType: formData.get('accountType') as string,
    handle: ((formData.get('handle') as string) || '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-'),
    headline: formData.get('headline') as string,
    bio: (formData.get('bio') as string) || undefined,
    avatarUrl: (formData.get('avatarUrl') as string) || undefined,
    company: (formData.get('company') as string) || undefined,
    websiteUrl: (formData.get('websiteUrl') as string) || undefined,
    offerings,
    audiences
  }

  const parsed = accountFormSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(i => i.message).join(', '))
  }

  // Insert account
  const [account] = await db
    .insert(accountsTable)
    .values({
      name: parsed.data.name,
      accountType: parsed.data.accountType,
      handle: parsed.data.handle,
      headline: parsed.data.headline,
      bio: parsed.data.bio ?? null,
      avatarUrl: parsed.data.avatarUrl || null,
      company: parsed.data.company ?? null,
      websiteUrl: parsed.data.websiteUrl || null
    })
    .returning()

  if (!account) throw new Error('Failed to create account')

  // Insert offerings if provided
  if (parsed.data.offerings.length > 0) {
    await db.insert(offeringsTable).values(
      parsed.data.offerings.map(o => ({
        accountId: account.id,
        name: o.name,
        type: o.type,
        tagline: o.tagline || null,
        description: o.description || null,
        url: o.url || null,
        isActive: true
      }))
    )
  }

  // Insert audiences if provided
  if (parsed.data.audiences.length > 0) {
    await db.insert(audiencesTable).values(
      parsed.data.audiences.map(a => ({
        accountId: account.id,
        name: a.name,
        painPoints: a.painPoints,
        goals: a.goals
      }))
    )
  }

  redirect(`/accounts/${account.id}`)
}

export async function updateAccountAction(input: UpdateAccountInput) {
  try {
    const parsed = updateAccountSchema.safeParse({
      ...input,
      handle: (input.handle || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-')
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
