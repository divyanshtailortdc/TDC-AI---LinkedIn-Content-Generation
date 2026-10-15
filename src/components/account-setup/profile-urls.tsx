'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'

export type ProfileUrls = { linkedinUrl: string; websiteUrl: string }

const ProfileUrlsContext = createContext<{
  urls: ProfileUrls
  setUrls: (urls: ProfileUrls) => void
} | null>(null)

/**
 * Carries the Profile form's LinkedIn and Website URLs over to the AI
 * assistant beside it, so the assistant reads them from the form instead of
 * asking for them a second time.
 */
export function ProfileUrlsProvider({
  initial,
  children
}: {
  initial: ProfileUrls
  children: ReactNode
}) {
  const [urls, setUrls] = useState(initial)
  const value = useMemo(() => ({ urls, setUrls }), [urls])
  return (
    <ProfileUrlsContext.Provider value={value}>
      {children}
    </ProfileUrlsContext.Provider>
  )
}

/** The URLs currently typed into the Profile form, or null outside a provider. */
export function useProfileUrls(): ProfileUrls | null {
  return useContext(ProfileUrlsContext)?.urls ?? null
}

/** Called by the Profile form so the assistant sees what is typed. */
export function useReportProfileUrls(linkedinUrl: string, websiteUrl: string) {
  const setUrls = useContext(ProfileUrlsContext)?.setUrls
  useEffect(() => {
    setUrls?.({ linkedinUrl, websiteUrl })
  }, [setUrls, linkedinUrl, websiteUrl])
}
