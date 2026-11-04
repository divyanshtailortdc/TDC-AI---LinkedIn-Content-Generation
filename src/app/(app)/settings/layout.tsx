import { PageHeader } from '@/components/page-header'
import { SettingsTabs } from './settings-tabs'

/** The header and tabs every settings page shares; each tab is a route. */
export default function SettingsLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Settings"
        description="Your account, how you sign in, and the app's colours."
        bottomContent={<SettingsTabs />}
      />
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  )
}
