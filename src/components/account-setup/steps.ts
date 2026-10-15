import {
  BookOpen,
  Mic,
  Play,
  SlidersHorizontal,
  Target,
  User,
  type LucideIcon
} from 'lucide-react'

/** The account setup steps, in order. */
export type SetupStep = {
  key: string
  label: string
  /** Path under /accounts/[id]; empty for the first step. */
  path: string
  icon: LucideIcon
  title: string
  description: string
  optional?: boolean
}

export const SETUP_STEPS: SetupStep[] = [
  {
    key: 'profile',
    label: 'Profile',
    path: '',
    icon: User,
    title: 'Profile',
    description: 'Tell us about you or your business.'
  },
  {
    key: 'voice',
    label: 'Voice',
    path: '/voice',
    icon: Mic,
    title: 'Voice',
    description: 'How your posts should sound.'
  },
  {
    key: 'knowledge',
    label: 'Knowledge',
    path: '/knowledge',
    icon: BookOpen,
    title: 'Knowledge',
    description:
      'Add sources so posts are grounded in facts you can stand behind.'
  },
  {
    key: 'goals',
    label: 'Goals',
    path: '/goals',
    icon: Target,
    title: 'Goals',
    description: 'What your posts should achieve and the one message to land.'
  },
  {
    key: 'preferences',
    label: 'Preferences',
    path: '/preferences',
    icon: SlidersHorizontal,
    title: 'Preferences',
    description: 'What to post about, and an optional schedule.'
  },
  {
    key: 'runs',
    label: 'Runs',
    path: '/runs',
    icon: Play,
    title: 'Runs',
    description: 'Start a run and follow its progress.'
  }
]

/** Which step a pathname belongs to; falls back to the first step. */
export function getStepIndex(pathname: string, accountId: string): number {
  const base = `/accounts/${accountId}`
  const index = SETUP_STEPS.findIndex(
    step =>
      step.path !== '' &&
      (pathname === base + step.path ||
        pathname.startsWith(`${base}${step.path}/`))
  )
  return index === -1 ? 0 : index
}
