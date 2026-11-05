import { SECURITY_SETTINGS_PATH } from '@/lib/settings-path'
import { redirect } from 'next/navigation'

/** Security is the first settings tab. */
export default function SettingsPage() {
  redirect(SECURITY_SETTINGS_PATH)
}
