import { Sidebar } from '@/components/sidebar'
import { ToastContainer } from '@/components/toast-notification'

export default function AppLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        {children}
      </main>
      <ToastContainer />
    </div>
  )
}
