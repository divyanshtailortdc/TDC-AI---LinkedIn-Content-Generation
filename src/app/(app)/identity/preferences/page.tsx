import { StepFields } from '@/components/account-setup/setup-frame'
import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { preferencesTable } from '@/db/schema'
import { resolvePreferences } from '@/lib/ai/context'
import { requireIdentity } from '@/lib/identity'
import { eq } from 'drizzle-orm'
import { PreferencesForm } from './preferences-form'

export default async function PreferencesPage() {
  const account = await requireIdentity()
  const [existingPreferences] = await db
    .select()
    .from(preferencesTable)
    .where(eq(preferencesTable.accountId, account.id))

  // The same resolution the pipeline uses, so the form shows what runs will see.
  const prefs = resolvePreferences(existingPreferences)

  return (
    <SetupShell account={account} hasSavedData={Boolean(existingPreferences)}>
      {/* The automatic schedule moved to the Schedule page. */}
      <StepFields>
        <PreferencesForm
          accountId={account.id}
          hasSaved={Boolean(existingPreferences)}
          initial={{
            ideasPerRun: prefs.ideasPerRun,
            post_constraints: {
              cta_required: prefs.constraints.cta_required
            },
            guardrails: prefs.guardrails
          }}
        />
      </StepFields>
    </SetupShell>
  )
}
