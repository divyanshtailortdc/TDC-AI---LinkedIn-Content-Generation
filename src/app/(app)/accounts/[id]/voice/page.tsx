import { StepFields } from '@/components/account-setup/setup-frame'
import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { voiceConfigsTable } from '@/db/schema'
import { accountIdOr404, getAccountOr404 } from '@/lib/account-route'
import { eq } from 'drizzle-orm'
import { VoiceForm } from './voice-form'

export const dynamic = 'force-dynamic'

interface VoicePageProps {
  params: Promise<{ id: string }>
}

export default async function VoicePage({ params }: VoicePageProps) {
  const id = accountIdOr404((await params).id, '/voice')

  const [account, voiceConfig] = await Promise.all([
    getAccountOr404(id),
    db.query.voiceConfigsTable.findFirst({
      where: eq(voiceConfigsTable.accountId, id)
    })
  ])

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
