// The fictional demo customer whose workspace the help-doc screenshots show:
// Alex Morgan (docs-demo@example.test). Creates the user when missing (no
// identity: that is set up through the real UI by seed-demo.mjs) and writes a
// fresh signed better-auth session cookie to /tmp/docs-shots/session.json.
//
//   node --env-file=.env scripts/docs-screenshots/demo-user.mjs
//
// capture.mjs calls mintDemoSession() itself, so a capture never runs on an
// expired cookie. Run with the dev server's BETTER_AUTH_URL and
// BETTER_AUTH_SECRET: they decide the cookie's name (__Secure- prefix on
// https) and its signature. The demo user is the only account this touches.
import postgres from 'postgres'
import { createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEMO_EMAIL = 'docs-demo@example.test'
export const DEMO_NAME = 'Alex Morgan'
export const SESSION_FILE = '/tmp/docs-shots/session.json'

/** Creates the demo user if missing, signs a new session for it and saves the cookie. */
export async function mintDemoSession() {
  for (const key of ['DATABASE_URL', 'BETTER_AUTH_SECRET']) {
    if (!process.env[key]) throw new Error(`${key} is not set (run with --env-file=.env)`)
  }
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    let [user] = await sql`select id from auth_users where email = ${DEMO_EMAIL}`
    if (!user) {
      ;[user] = await sql`
        insert into auth_users (name, email, email_verified)
        values (${DEMO_NAME}, ${DEMO_EMAIL}, true)
        returning id`
      console.log('created demo user', user.id)
    }
    // Expired demo sessions are dropped so they don't pile up.
    await sql`delete from auth_sessions where user_id = ${user.id} and expires_at < now()`
    const token = randomBytes(32).toString('base64url')
    await sql`
      insert into auth_sessions (token, user_id, expires_at, created_at, updated_at)
      values (${token}, ${user.id}, now() + interval '7 days', now(), now())`
    const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(token).digest('base64')
    const secure = (process.env.BETTER_AUTH_URL ?? '').startsWith('https://')
    const session = {
      email: DEMO_EMAIL,
      userId: user.id,
      name: `${secure ? '__Secure-' : ''}better-auth.session_token`,
      value: encodeURIComponent(`${token}.${signature}`)
    }
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true })
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session))
    return session
  } finally {
    await sql.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const session = await mintDemoSession()
  console.log('demo user', session.userId, DEMO_EMAIL, '→ session cookie', session.name, 'in', SESSION_FILE)
}
