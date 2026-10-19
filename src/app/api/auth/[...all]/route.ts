import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'

/** Every Better Auth endpoint: Google and passkey sign-in, callbacks, admin. */
export const { GET, POST } = toNextJsHandler(auth)
