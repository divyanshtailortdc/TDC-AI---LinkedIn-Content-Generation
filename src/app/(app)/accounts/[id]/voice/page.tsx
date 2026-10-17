import { StepFields } from '@/components/account-setup/setup-frame'
import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { accountsTable, voiceConfigsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { isUuid } from '@/lib/ids'
import { VoiceForm } from './voice-form'

export const dynamic = 'force-dynamic'

interface VoicePageProps {
  params: Promise<{ id: string }>
}

export default async function VoicePage({ params }: VoicePageProps) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, id)
  })

  if (!account) notFound()

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
