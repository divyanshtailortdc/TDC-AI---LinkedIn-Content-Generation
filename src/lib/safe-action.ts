//todo: can we remove this
/**
 * Re-exports the safe action client and helper types.
 * Import from this file in Server Actions:
 *
 * @example
 * import { action } from '~/lib/safe-action'
 *
 * export const createIdea = action
 *   .metadata({ actionName: 'createIdea' })
 *   .schema(z.object({ title: z.string() }))
 *   .action(async ({ parsedInput }) => {
 *     // ...
 *   })
 */
export { actionClient as action } from './safe-action-client'
