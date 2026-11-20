import type { PlatformId } from '@/lib/platforms'
import { useId, type ReactElement } from 'react'

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

/** X's mark, in the current text colour. */
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

/** Facebook's mark, in the current text colour. */
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

/** Instagram's mark, in the current text colour. */
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

/** Threads' mark, in the current text colour. */
export function ThreadsMark({ className }: { className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className}>
      <path
        fill="currentColor"
        d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z"
      />
    </svg>
  )
}

/** LinkedIn's logo in its own blue, the letters white. */
function LinkedInBrandMark({ className }: { className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className}>
      <rect x="1" y="1" width="22" height="22" rx="2" fill="#fff" />
      <path
        fill="#0A66C2"
        d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z"
      />
    </svg>
  )
}

/** X's logo: black, and white in dark mode, as X shows it. */
function XBrandMark({ className }: { className: string }) {
  return <XMark className={`${className} text-black dark:text-white`} />
}

/** Threads' logo: black, and white in dark mode, as Threads shows it. */
function ThreadsBrandMark({ className }: { className: string }) {
  return <ThreadsMark className={`${className} text-black dark:text-white`} />
}

/** Facebook's logo in its own blue, the "f" white. */
function FacebookBrandMark({ className }: { className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="11.5" fill="#fff" />
      <path
        fill="#0866FF"
        d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"
      />
    </svg>
  )
}

/** Instagram's logo: the white camera on its yellow-to-purple gradient. */
function InstagramBrandMark({ className }: { className: string }) {
  // One gradient per mark: several can be on the page at once.
  const gradient = `ig-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className}>
      <defs>
        <radialGradient id={gradient} cx="0.3" cy="1.07" r="1.3">
          <stop offset="0" stopColor="#FDF497" />
          <stop offset="0.05" stopColor="#FDF497" />
          <stop offset="0.45" stopColor="#FD5949" />
          <stop offset="0.6" stopColor="#D6249F" />
          <stop offset="0.9" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill={`url(#${gradient})`} />
      <rect x="5" y="5" width="14" height="14" rx="4.2" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.4" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="16.4" cy="7.6" r="1" fill="#fff" />
    </svg>
  )
}

/** Each platform's logo in its own colours, where the app shows one. */
const BRAND_MARKS: Partial<
  Record<PlatformId, (props: { className: string }) => ReactElement>
> = {
  linkedin: LinkedInBrandMark,
  x: XBrandMark,
  threads: ThreadsBrandMark,
  facebook: FacebookBrandMark,
  instagram: InstagramBrandMark
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
  threads: ThreadsMark,
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

/**
 * A platform's mark, in the current text colour, or with `colored` its logo
 * in the platform's own colours (LinkedIn blue, Instagram's gradient…).
 */
export function PlatformMark({
  platform,
  className,
  colored = false
}: {
  platform: PlatformId
  className: string
  colored?: boolean
}) {
  const Mark = (colored && BRAND_MARKS[platform]) || MARKS[platform]
  return Mark ? (
    <Mark className={className} />
  ) : (
    <InitialMark platform={platform} className={className} />
  )
}
