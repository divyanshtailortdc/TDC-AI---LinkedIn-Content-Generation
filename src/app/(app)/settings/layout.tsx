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
        description="Your account and how you sign in."
        bottomContent={<SettingsTabs />}
      />
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-3xl space-y-6">{children}</div>
      </div>
    </div>
  )
}
