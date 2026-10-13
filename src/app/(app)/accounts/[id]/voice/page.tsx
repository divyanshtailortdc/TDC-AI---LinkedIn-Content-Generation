import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { AccountHeader } from '@/components/account-header'
import { db } from '@/db'
import { accountsTable, voiceConfigsTable } from '@/db/schema'
import { VoiceForm } from './voice-form'

export const dynamic = 'force-dynamic'

interface VoicePageProps {
  params: Promise<{ id: string }>
}

export default async function VoicePage({ params }: VoicePageProps) {
  const { id } = await params

  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, id)
  })

  if (!account) notFound()

  const voiceConfig = await db.query.voiceConfigsTable.findFirst({
    where: eq(voiceConfigsTable.accountId, id)
  })

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <AccountHeader account={account} />
      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="max-w-7xl mx-auto">
          {/* Remount after each save so the form shows what was stored. */}
          <VoiceForm
            key={voiceConfig?.updatedAt.getTime() ?? 'new'}
            accountId={account.id}
            initialConfig={voiceConfig}
          />
        </div>
      </div>
    </div>
  )
}
