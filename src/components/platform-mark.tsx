import type { PlatformId } from '@/lib/platforms'
import type { ReactElement } from 'react'

/** LinkedIn's "in" mark, in the current text colour. */
export function LinkedInMark({ className }: { className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className}>
      <path
        fill="currentColor"
        d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z"
      />
    </svg>
  )
}

/** X's mark, in the current text colour. Listed as coming soon. */
export function XMark({ className }: { className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className}>
      <path
        fill="currentColor"
        d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
      />
    </svg>
  )
}

/** Facebook's mark, in the current text colour. Listed as coming soon. */
export function FacebookMark({ className }: { className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className}>
      <path
        fill="currentColor"
        d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"
      />
    </svg>
  )
}

/** Instagram's mark, in the current text colour. Listed as coming soon. */
export function InstagramMark({ className }: { className: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      className={className}
    >
      <rect x="2.1" y="2.1" width="19.8" height="19.8" rx="5.6" />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="17.7" cy="6.3" r="0.6" fill="currentColor" />
    </svg>
  )
}

/**
 * Each platform's mark (src/lib/platforms); a new platform adds its own here.
 * One without a mark yet shows its initial.
 */
const MARKS: Partial<
  Record<PlatformId, (props: { className: string }) => ReactElement>
> = {
  linkedin: LinkedInMark,
  x: XMark,
  facebook: FacebookMark,
  instagram: InstagramMark
}

function InitialMark({ platform, className }: { platform: PlatformId; className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className}>
      <rect width="24" height="24" rx="5" fill="currentColor" opacity="0.15" />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fill="currentColor"
      >
        {platform.charAt(0).toUpperCase()}
      </text>
    </svg>
  )
}

/** A platform's mark, in the current text colour. */
export function PlatformMark({
  platform,
  className
}: {
  platform: PlatformId
  className: string
}) {
  const Mark = MARKS[platform]
  return Mark ? (
    <Mark className={className} />
  ) : (
    <InitialMark platform={platform} className={className} />
  )
}
