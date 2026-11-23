'use client'

import { SectionCard } from '@/components/identity-fields'
import { PlatformMark } from '@/components/platform-mark'
import { CREATABLE_PLATFORMS, PLATFORMS, type PlatformId } from '@/lib/formats'
import { IDENTITY_PATH } from '@/lib/identity-path'
import { Plus, X } from 'lucide-react'
import Link from 'next/link'

/**
 * Where the identity posts, as a tag per platform with its logo. While the
 * Profile step is being edited, a tag can be removed (all but the last) and
 * any other platform added; the header's Save saves them with the profile.
 */
export function IdentityPlatforms({
  value,
  editing,
  onChange
}: {
  value: readonly PlatformId[]
  editing: boolean
  onChange: (next: PlatformId[]) => void
}) {
  // In the registry's order, so tags keep their places as they change.
  const included = CREATABLE_PLATFORMS.filter(p => value.includes(p))
  const addable = CREATABLE_PLATFORMS.filter(p => !value.includes(p))
  const last = included.length <= 1

  return (
    <SectionCard
      title="Platforms"
      description={
        editing
          ? 'Where this identity posts. Each platform gets its own profile link below.'
          : 'Where this identity posts.'
      }
    >
      <ul className="flex flex-wrap gap-2" aria-label="Platforms this identity posts on">
        {included.map(platform => (
          <li
            key={platform}
            className="border-border bg-surface text-foreground inline-flex h-8 items-center gap-1.5 rounded-full border pr-1 pl-2.5 text-xs font-medium"
          >
            <PlatformMark platform={platform} className="h-4 w-4 shrink-0" />
            <span className={editing ? '' : 'pr-1.5'}>{PLATFORMS[platform].label}</span>
            {editing && (
              <button
                type="button"
                onClick={() => onChange(value.filter(p => p !== platform))}
                disabled={last}
                aria-label={`Remove ${PLATFORMS[platform].label}`}
                title={
                  last
                    ? 'Keep at least one platform'
                    : `Remove ${PLATFORMS[platform].label}`
                }
                className="text-muted hover:text-foreground hover:bg-surface-hover flex h-6 w-6 cursor-pointer items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {editing && addable.length > 0 && (
        <div className="mt-4">
          <p className="text-muted mb-2 text-[11px] font-semibold tracking-wide uppercase">
            Add a platform
          </p>
          <div className="flex flex-wrap gap-2">
            {addable.map(platform => (
              <button
                key={platform}
                type="button"
                onClick={() => onChange([...value, platform])}
                aria-label={`Add ${PLATFORMS[platform].label}`}
                className="border-border text-muted hover:text-foreground hover:border-accent/40 hover:bg-surface-hover inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-dashed px-2.5 text-xs font-medium transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <PlatformMark platform={platform} className="h-4 w-4 shrink-0" />
                {PLATFORMS[platform].label}
              </button>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <p className="text-muted mt-4 text-xs leading-relaxed">
          {last
            ? 'An identity posts on at least one platform. '
            : 'Removing a platform stops new posts for it; its saved posts stay. '}
          A platform added starts with its main post type; choose more in{' '}
          <Link
            href={`${IDENTITY_PATH}/preferences`}
            className="text-accent hover:text-accent-hover font-medium"
          >
            Preferences → Platforms
          </Link>
          .
        </p>
      )}
    </SectionCard>
  )
}
