'use server'

import { db } from '@/db'
import { accountsTable, offeringsTable, audiencesTable } from '@/db/schema'
import { redirect } from 'next/navigation'
import { z } from 'zod'

const offeringSchema = z.object({
  name: z.string().min(1, 'Offering name is required'),
  type: z.string().default('service'),
  tagline: z.string().optional(),
  description: z.string().optional(),
  url: z.string().url().optional().or(z.literal('')),
})

const audienceSchema = z.object({
  name: z.string().min(1, 'Audience name is required'),
  painPoints: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
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
  audiences: z.array(audienceSchema).default([]),
})

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
    handle: (formData.get('handle') as string || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
    headline: formData.get('headline') as string,
    bio: (formData.get('bio') as string) || undefined,
    avatarUrl: (formData.get('avatarUrl') as string) || undefined,
    company: (formData.get('company') as string) || undefined,
    websiteUrl: (formData.get('websiteUrl') as string) || undefined,
    offerings,
    audiences,
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
      websiteUrl: parsed.data.websiteUrl || null,
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
        isActive: true,
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
        goals: a.goals,
      }))
    )
  }

  redirect(`/accounts/${account.id}`)
}
