'use client'

import { ImageOff } from 'lucide-react'
import { useMemo, useState } from 'react'

/** Remote images and backgrounds: what "Show images" lets load. */
const REMOTE_CONTENT =
  /(?:\bsrc|\bbackground)\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:/i

/**
 * The HTML document the iframe shows. Its CSP allows no scripts, frames,
 * forms or connections, and remote images and fonts only once the reader
 * asks: those are how senders track opens. Links open in a new tab, without
 * a referrer.
 */
function emailDocument(html: string, allowRemote: boolean) {
  const remote = allowRemote ? ' https:' : ''
  const csp = [
    "default-src 'none'",
    `img-src data:${remote}`,
    `font-src data:${remote}`,
    "style-src 'unsafe-inline'",
    "form-action 'none'"
  ].join('; ')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>html{color-scheme:light}body{margin:0;padding:16px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2937;background:#fff;overflow-wrap:anywhere}img{max-width:100%}table{max-width:100%}</style></head><body>${html}</body></html>`
}

/**
 * An email's body. HTML is shown in a sandboxed iframe: no scripts, and an
 * opaque origin, so it cannot read the app's cookies or pages whatever it
 * contains. Without HTML, the plain text.
 *
 * Key it by message, so "Show images" does not carry over to the next email.
 */
export function EmailBody({
  html,
  text
}: {
  html: string | null
  text: string | null
}) {
  const [showRemote, setShowRemote] = useState(false)
  const srcDoc = useMemo(
    () => (html ? emailDocument(html, showRemote) : null),
    [html, showRemote]
  )

  if (!srcDoc) {
    return text ? (
      <pre className="text-foreground font-sans text-sm leading-relaxed break-words whitespace-pre-wrap">
        {text}
      </pre>
    ) : (
      <p className="text-muted text-sm italic">This email has no text.</p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {!showRemote && html && REMOTE_CONTENT.test(html) && (
        <div className="border-border bg-surface-hover/60 text-muted flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs">
          <ImageOff aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            Remote images are hidden, so the sender can't see that you opened
            this email.
          </span>
          <button
            type="button"
            onClick={() => setShowRemote(true)}
            className="text-foreground cursor-pointer font-medium underline-offset-2 hover:underline"
          >
            Show images
          </button>
        </div>
      )}
      <iframe
        title="Email content"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        className="border-border min-h-[60vh] w-full flex-1 rounded-xl border bg-white"
      />
    </div>
  )
}
