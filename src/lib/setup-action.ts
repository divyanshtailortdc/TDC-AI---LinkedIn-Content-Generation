import 'server-only'

import { NotFoundError } from './account-guard'
import { SetupInputError } from './setup-payloads'

export type SetupActionResult<T extends object = object> =
  | ({ success: true } & T)
  | { success: false; error: string }

/**
 * Runs a setup server action, returning an expected problem (input that was
 * refused, an identity that is not the user's) as `{ success: false, error }`.
 * Production React replaces a thrown action's message with "Minified React
 * error", so a reason must come back as a value. Anything else still throws.
 */
export async function setupAction<T extends object>(
  run: () => Promise<T>
): Promise<SetupActionResult<T>> {
  try {
    return { success: true, ...(await run()) }
  } catch (error) {
    if (error instanceof SetupInputError || error instanceof NotFoundError) {
      return { success: false, error: error.message }
    }
    throw error
  }
}
