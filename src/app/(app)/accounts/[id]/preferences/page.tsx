import { StepFields } from '@/components/account-setup/setup-frame'
import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { accountsTable, preferencesTable, schedulesTable } from '@/db/schema'
import { resolvePreferences } from '@/lib/ai/context'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { ScheduleForm } from '../schedule/schedule-form'
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

  const [[existingPreferences], schedule] = await Promise.all([
    db
      .select()
      .from(preferencesTable)
      .where(eq(preferencesTable.accountId, id)),
    db.query.schedulesTable.findFirst({
      where: eq(schedulesTable.accountId, id)
    })
  ])

  // The same resolution the pipeline uses, so the form shows what runs will see.
  const prefs = resolvePreferences(existingPreferences)

  return (
    <SetupShell
      account={account}
      hasSavedData={Boolean(existingPreferences) || Boolean(schedule)}
    >
      <StepFields>
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
        {/* Optional, so it lives here rather than as a step of its own. */}
        <div className="mt-8">
          <ScheduleForm accountId={account.id} initialSchedule={schedule} />
        </div>
      </StepFields>
    </SetupShell>
  )
}
