/**
 * Goes to `next` after signing in, as a full page load rather than a
 * client-side navigation.
 *
 * `/` is two pages at one address (src/proxy.ts): the website while signed
 * out, the dashboard once signed in. The client router may still hold the
 * website for `/` (prefetched or visited before signing in), and a
 * router.push could show it again, as if the sign-in had not worked. A full
 * load asks the server afresh, with the new session cookie.
 */
export function enterApp(next: string) {
  window.location.assign(next)
}
