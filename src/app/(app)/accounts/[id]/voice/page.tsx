import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { AccountHeader } from '~/components/account-header'
import { db } from '~/db'
import { accountsTable, voiceConfigsTable } from '~/db/schema'
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
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <AccountHeader account={account} />
      <VoiceForm accountId={account.id} initialConfig={voiceConfig} />
    </div>
  )
}
