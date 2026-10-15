'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from 'react'

export type ProfileUrls = { linkedinUrl: string; websiteUrl: string }
export type ProfileUrlErrors = Partial<Record<keyof ProfileUrls, string>>

type ProfileUrlsContextValue = {
  urls: ProfileUrls
  /** Validation messages for the two URLs, shown in the assistant card. */
  errors: ProfileUrlErrors
  /** Changing a URL clears its error. */
  setUrls: (patch: Partial<ProfileUrls>) => void
  setErrors: (errors: ProfileUrlErrors) => void
}

const ProfileUrlsContext = createContext<ProfileUrlsContextValue | null>(null)

/**
 * Holds the LinkedIn and Website URLs of the Profile step. They are entered in
 * the AI assistant's Online presence card, while the Profile form beside it
 * validates and saves them, so both read and write the same values here.
 */
export function ProfileUrlsProvider({
  initial,
  children
}: {
  initial: ProfileUrls
  children: ReactNode
}) {
  const [urls, setUrlState] = useState(initial)
  const [errors, setErrors] = useState<ProfileUrlErrors>({})

  const setUrls = useCallback((patch: Partial<ProfileUrls>) => {
    setUrlState(prev => ({ ...prev, ...patch }))
    setErrors(prev => {
      const next = { ...prev }
      for (const key of Object.keys(patch) as Array<keyof ProfileUrls>) {
        delete next[key]
      }
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ urls, errors, setUrls, setErrors }),
    [urls, errors, setUrls]
  )
  return (
    <ProfileUrlsContext.Provider value={value}>
      {children}
    </ProfileUrlsContext.Provider>
  )
}

/** The Profile step's URLs, or null outside a provider. */
export function useProfileUrls(): ProfileUrlsContextValue | null {
  return useContext(ProfileUrlsContext)
}
