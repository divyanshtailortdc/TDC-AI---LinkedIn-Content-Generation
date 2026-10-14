import { redirect } from 'next/navigation'

interface SchedulePageProps {
  params: Promise<{ id: string }>
}

/** Schedule is now a section of Preferences; keep old links working. */
export default async function SchedulePage({ params }: SchedulePageProps) {
  const { id } = await params
  redirect(`/accounts/${id}/preferences#schedule`)
}
