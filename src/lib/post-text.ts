/**
 * The text of a post as it is published: hook, body and call to action, each
 * on its own paragraph. One definition for the draft, the quality checks and
 * the character count shown, so they cannot disagree about how long a post is.
 */
export function postFullText(post: {
  hook: string
  body: string
  cta?: string | null
}): string {
  return [post.hook, post.body, post.cta].filter(Boolean).join('\n\n')
}

export function postCharCount(post: {
  hook: string
  body: string
  cta?: string | null
}): number {
  return postFullText(post).length
}
