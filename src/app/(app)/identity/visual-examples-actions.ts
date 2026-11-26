'use server'

import { requireOwnedAccount } from '@/lib/account-guard'
import { isPlatformId, type PlatformId } from '@/lib/formats'
import { requireUser } from '@/lib/session'
import { AccountIdSchema, parseSetupPayload } from '@/lib/setup-payloads'
import {
  addUploadedExamples,
  exampleViews,
  ExampleUploadError,
  removeExample
} from '@/lib/visual-examples/store'
import type { VisualExampleView } from '@/lib/visual-examples/types'

/**
 * An identity's example posts (src/lib/visual-examples), from the Profile
 * page: listed, added by upload, removed. New images in the Like my posts
 * style follow them.
 */

type Result<T> = ({ success: true } & T) | { success: false; error: string }

const failure = (error: unknown, fallback: string) => ({
  success: false as const,
  error:
    error instanceof ExampleUploadError || error instanceof Error
      ? error.message
      : fallback
})

function platformOf(value: unknown): PlatformId {
  if (!isPlatformId(value)) throw new Error('Unknown platform.')
  return value
}

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export async function getVisualExamples(
  rawAccountId: string
): Promise<Result<{ examples: VisualExampleView[] }>> {
  const user = await requireUser()
  try {
    const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
    await requireOwnedAccount(user.id, accountId)
    return { success: true, examples: await exampleViews(accountId) }
  } catch (error) {
    return failure(error, 'The example posts could not be read.')
  }
}

/**
 * Adds uploaded images as example posts for one platform. The form carries
 * accountId, platform and one or more `image` files; the browser has already
 * shrunk each one to fit the request.
 */
export async function uploadVisualExamples(
  form: FormData
): Promise<Result<{ examples: VisualExampleView[]; added: number }>> {
  const user = await requireUser()
  try {
    const accountId = parseSetupPayload(AccountIdSchema, form.get('accountId'))
    await requireOwnedAccount(user.id, accountId)
    const platform = platformOf(form.get('platform'))
    const files = form
      .getAll('image')
      .filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f)
    if (files.length === 0) {
      return { success: false, error: 'Choose an image to add.' }
    }
    const added = await addUploadedExamples(
      accountId,
      platform,
      await Promise.all(
        files.map(async f => ({
          data: new Uint8Array(await f.arrayBuffer()),
          mediaType: f.type,
          name: f.name
        }))
      )
    )
    return { success: true, added, examples: await exampleViews(accountId) }
  } catch (error) {
    return failure(error, 'The images could not be added.')
  }
}

export async function removeVisualExample(
  rawAccountId: string,
  exampleId: string
): Promise<Result<{ examples: VisualExampleView[] }>> {
  const user = await requireUser()
  try {
    const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
    await requireOwnedAccount(user.id, accountId)
    if (!isUuid(exampleId)) throw new Error('Unknown example.')
    await removeExample(accountId, exampleId)
    return { success: true, examples: await exampleViews(accountId) }
  } catch (error) {
    return failure(error, 'The image could not be removed.')
  }
}
