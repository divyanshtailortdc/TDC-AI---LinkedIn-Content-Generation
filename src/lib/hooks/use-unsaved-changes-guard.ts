'use client'

import { useEffect } from 'react'

/**
 * While `dirty`, asks before unsaved changes are thrown away: closing or
 * reloading the tab (the browser's own prompt), and following a link to
 * another page of the app (`message`, in a confirm). Links that open a new
 * tab, lead off the site, stay on this page or sit inside editable text are
 * left alone. The same guard the Posts editor keeps inline.
 */
export function useUnsavedChangesGuard(dirty: boolean, message: string) {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const onLinkClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest?.('a[href]')
      if (!(link instanceof HTMLAnchorElement)) return
      if (link.isContentEditable) return
      if (link.target === '_blank' || event.metaKey || event.ctrlKey) return
      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname) return
      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onLinkClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onLinkClick, true)
    }
  }, [dirty, message])
}
