import { StepFields } from '@/components/account-setup/setup-frame'
import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { preferencesTable, schedulesTable } from '@/db/schema'
import { accountIdOr404, getAccountOr404 } from '@/lib/account-route'
import { resolvePreferences } from '@/lib/ai/context'
import { eq } from 'drizzle-orm'
import { ScheduleForm } from '../schedule/schedule-form'
import { PreferencesForm } from './preferences-form'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function PreferencesPage({ params }: PageProps) {
  const id = accountIdOr404((await params).id, '/preferences')

  const [account, [existingPreferences], schedule] = await Promise.all([
    getAccountOr404(id),
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
        <div className="mt-5">
          <ScheduleForm accountId={account.id} initialSchedule={schedule} />
        </div>
      </StepFields>
    </SetupShell>
  )
}
