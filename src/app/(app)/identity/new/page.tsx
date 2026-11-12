import { CreateIdentity } from '../create-identity'

/**
 * Creates another identity (a separate persona, a brand): the same three
 * steps as the first one, and it becomes the active identity once saved.
 */
export default function NewIdentityPage() {
  return <CreateIdentity another />
}
