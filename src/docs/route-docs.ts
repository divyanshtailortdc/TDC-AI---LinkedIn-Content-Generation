import { findDocPage, type DocPage } from './nav'

/**
 * Which help page explains each page of the app, for the help button's
 * "Help for this page". The longest matching prefix wins, so a page under a
 * section (/posts/<id>) can have its own entry before the section's own. An
 * app page not listed gets the docs home.
 */
const ROUTE_DOCS: Array<{ path: string; slug: string; exact?: boolean }> = [
  { path: '/', slug: 'getting-started/dashboard', exact: true },
  { path: '/identity/new', slug: 'getting-started/identities' },
  { path: '/identities', slug: 'getting-started/identities' },
  { path: '/identity/voice', slug: 'account-setup/voice' },
  { path: '/identity/knowledge', slug: 'account-setup/knowledge' },
  { path: '/identity/preferences', slug: 'account-setup/preferences' },
  { path: '/identity/runs', slug: 'account-setup/runs' },
  { path: '/identity', slug: 'account-setup/profile' },
  { path: '/goals', slug: 'account-setup/goals' },
  { path: '/ideas', slug: 'account-setup/ideas' },
  { path: '/brand', slug: 'account-setup/brand-theme' },
  { path: '/newsletters/inbox', slug: 'publishing/newsletters/inbox' },
  // The library moved into the Knowledge base; the path redirects there.
  { path: '/newsletters/library', slug: 'account-setup/knowledge' },
  { path: '/newsletters', slug: 'publishing/newsletters/discover' },
  { path: '/runs', slug: 'publishing/run-details' },
  { path: '/posts/', slug: 'publishing/posts/editing' },
  { path: '/posts', slug: 'publishing/posts/overview' },
  { path: '/schedule', slug: 'publishing/schedule' },
  { path: '/settings/integrations', slug: 'settings/integrations' },
  { path: '/settings/theme', slug: 'settings/theme' },
  { path: '/settings', slug: 'settings/security' }
]

function matches(pathname: string, route: (typeof ROUTE_DOCS)[number]) {
  if (route.exact) return pathname === route.path
  if (route.path.endsWith('/')) return pathname.startsWith(route.path)
  return pathname === route.path || pathname.startsWith(`${route.path}/`)
}

/** The help page for an app pathname, or null when none is specific to it. */
export function docForAppPath(pathname: string): DocPage | null {
  const route = ROUTE_DOCS.filter(route => matches(pathname, route)).sort(
    (a, b) => b.path.length - a.path.length
  )[0]
  return route ? (findDocPage(route.slug) ?? null) : null
}

/** For tests: every slug the map points at. */
export const ROUTE_DOC_SLUGS = ROUTE_DOCS.map(route => route.slug)
