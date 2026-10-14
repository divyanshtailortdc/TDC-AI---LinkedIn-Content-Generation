import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { accountsTable, preferencesTable } from '@/db/schema'
import { resolvePreferences } from '@/lib/ai/context'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { PreferencesForm } from './preferences-form'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function PreferencesPage({ params }: PageProps) {
  const { id } = await params

  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, id)
  })

  if (!account) {
    notFound()
  }

  const [existingPreferences] = await db
    .select()
    .from(preferencesTable)
    .where(eq(preferencesTable.accountId, id))

  // The same resolution the pipeline uses, so the form shows what runs will see.
  const prefs = resolvePreferences(existingPreferences)

  return (
    <SetupShell account={account}>
      <PreferencesForm
        accountId={account.id}
        hasSaved={Boolean(existingPreferences)}
        initial={{
          pillars: prefs.pillars,
          ideasPerRun: prefs.ideasPerRun,
          post_constraints: {
            cta_required: prefs.constraints.cta_required
          },
          guardrails: prefs.guardrails
        }}
      />
    </SetupShell>
  )
}
