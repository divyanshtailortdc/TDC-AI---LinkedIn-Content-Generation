import { StepFields } from '@/components/account-setup/setup-frame'
import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { voiceConfigsTable } from '@/db/schema'
import { requireIdentity } from '@/lib/identity'
import { eq } from 'drizzle-orm'
import { VoiceForm } from './voice-form'

export const dynamic = 'force-dynamic'

export default async function VoicePage() {
  const account = await requireIdentity()
  const id = account.id
  const voiceConfig = await db.query.voiceConfigsTable.findFirst({
    where: eq(voiceConfigsTable.accountId, id)
  })

  return (
    <SetupShell account={account} hasSavedData={Boolean(voiceConfig)}>
      <StepFields>
        {/* Remount after each save so the form shows what was stored. */}
        <VoiceForm
          key={voiceConfig?.updatedAt.getTime() ?? 'new'}
          accountId={account.id}
          initialConfig={voiceConfig}
        />
      </StepFields>
    </SetupShell>
  )
}
