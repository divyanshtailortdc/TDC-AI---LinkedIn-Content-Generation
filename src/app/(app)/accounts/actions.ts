'use server'

import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { redirect } from 'next/navigation'
import { z } from 'zod'

const accountSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  accountType: z.enum(['personal', 'company']),
  handle: z.string().min(1, 'Handle is required'),
  headline: z.string().min(1, 'Headline is required'),
  bio: z.string().optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
  company: z.string().optional(),
  websiteUrl: z.string().url().optional().or(z.literal('')),
})

export async function createAccount(formData: FormData) {
  const raw = {
    name: formData.get('name') as string,
    accountType: formData.get('accountType') as string,
    handle: formData.get('handle') as string,
    headline: formData.get('headline') as string,
    bio: (formData.get('bio') as string) || undefined,
    avatarUrl: (formData.get('avatarUrl') as string) || undefined,
    company: (formData.get('company') as string) || undefined,
    websiteUrl: (formData.get('websiteUrl') as string) || undefined,
  }

  const parsed = accountSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(i => i.message).join(', '))
  }

  const rows = await db
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

  const account = rows[0]
  if (!account) throw new Error('Failed to create account')

  redirect(`/accounts/${account.id}`)
}
