import { IDENTITY_PATH } from './identity-path'

/** The Knowledge base step of Account Setup. Its own module so client components can use it. */
export const KNOWLEDGE_PATH = `${IDENTITY_PATH}/knowledge`

/** Its "From newsletters" view: the stories the identity's newsletters brought in. */
export const NEWSLETTER_KNOWLEDGE_PATH = `${KNOWLEDGE_PATH}?view=newsletters`

/** The longest newsletter search kept, in the box and from ?q=. */
export const MAX_NEWSLETTER_QUERY_LENGTH = 200
