import { passkeyClient } from '@better-auth/passkey/client'
import { adminClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/**
 * Better Auth in the browser: Google and passkey sign-in, adding a passkey,
 * and sign out. No baseURL, so requests go to the origin the page was loaded
 * from.
 *
 * This only starts flows; it decides nothing about access. Every page, action
 * and API route checks the session on the server (src/lib/session.ts).
 */
export const authClient = createAuthClient({
  plugins: [
    passkeyClient(),
    // Exposes authClient.admin.* for the future admin panel. The server checks
    // the caller's role on every one of those endpoints.
    adminClient()
  ]
})
