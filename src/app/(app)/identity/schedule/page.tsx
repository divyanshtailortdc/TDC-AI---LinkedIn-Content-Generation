import { IDENTITY_PATH } from '@/lib/identity'
import { redirect } from 'next/navigation'

/** Schedule is now a section of Preferences; keep old links working. */
export default function SchedulePage() {
  redirect(`${IDENTITY_PATH}/preferences#schedule`)
}
