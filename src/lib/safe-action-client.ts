import { createSafeActionClient } from 'next-safe-action'
import { z } from 'zod'

/**
 * Base safe action client.
 * Attach middleware here (e.g. auth checks, rate limiting) as the project grows.
 */
export const actionClient = createSafeActionClient({
  defineMetadataSchema() {
    return z.object({
      actionName: z.string()
    })
  },
  handleServerError(error) {
    // Log server errors without leaking internals to the client
    console.error('[Server Action Error]:', error.message)
    if (error instanceof Error) {
      return error.message
    }
    return 'An unexpected error occurred'
  }
})
