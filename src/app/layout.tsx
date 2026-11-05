import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import {
  parseThemePrefs,
  THEME_PREFS_COOKIE,
  themePrefsCss
} from '@/lib/theme-prefs'
import { cookies } from 'next/headers'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin']
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin']
})

export const metadata: Metadata = {
  title: 'TDC LinkedIn Content Engine',
  description: 'AI-powered LinkedIn post generation with human-in-the-loop approval'
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  // The user's colours (Settings → Theme), on every page and in the first
  // paint. Only checked #rrggbb values reach this CSS; see parseThemePrefs.
  const themeCss = themePrefsCss(
    parseThemePrefs((await cookies()).get(THEME_PREFS_COOKIE)?.value)
  )

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {themeCss && (
        <head>
          <style>{themeCss}</style>
        </head>
      )}
      <body className="h-full">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
