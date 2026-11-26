/**
 * Where the app goes after the user switches identity, so every content
 * page behaves the same. A page of one item (a post, run, idea or blog)
 * belongs to the identity they left and would only say "belongs to another
 * identity", so its list opens instead. Query parameters that name the old
 * identity's records (a run's posts, the idea or blog a new blog starts
 * from) are dropped. Every other page reloads where it is with the new
 * identity's data. Returns null for a reload in place.
 *
 * Pure, so the identity switcher and tests share it.
 */

/** Lists whose pages of one item go back to the list. */
const ITEM_PAGE = /^\/(posts|runs|ideas|blogs)\/([^/]+)/

/** Parameters, per page, that name records of one identity. */
const IDENTITY_PARAMS: Record<string, string[]> = {
  '/posts': ['runId'],
  '/blogs/new': ['idea', 'from']
}

export function pathAfterSwitch(
  pathname: string,
  search: string
): string | null {
  const item = ITEM_PAGE.exec(pathname)
  // /blogs/new is a form, not a blog.
  if (item && !(item[1] === 'blogs' && item[2] === 'new')) return `/${item[1]}`

  const named = IDENTITY_PARAMS[pathname]
  if (!named) return null
  const params = new URLSearchParams(search)
  if (!named.some(name => params.has(name))) return null
  for (const name of named) params.delete(name)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}
