import { DocsShell } from '@/docs/components/docs-shell'

/**
 * The help pages: open to anyone (src/proxy.ts lets /docs through), so the
 * sign-in page can link to them, and outside the app's own layout, which is
 * signed-in only. Nothing here reads the session or any account data.
 */
export default function DocsLayout({
  children
}: {
  children: React.ReactNode
}) {
  return <DocsShell>{children}</DocsShell>
}
