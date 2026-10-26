import { eq, inArray, like } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import assert from 'node:assert'
import { createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { after, before, describe, it } from 'node:test'
import postgres from 'postgres'
import * as schema from '../src/db/schema'

/**
 * End-to-end checks against a running build of the app: the sign-in methods
 * on offer and sign-out, then one user calling another user's pages, API
 * routes and Server Actions directly, as an attacker would.
 *
 * Opt-in, because it needs a server and its database:
 *   AUTH_E2E_BASE_URL   the running app (`next build && next start`)
 *   DATABASE_URL        the same database the app uses (with the auth migrations)
 *   BETTER_AUTH_SECRET  the app's secret, to sign session cookies for test users
 * Server Actions are found through .next/server/server-reference-manifest.json,
 * so the build must be the one the server is running.
 */
const BASE = process.env.AUTH_E2E_BASE_URL
const DB_URL = process.env.DATABASE_URL
const SECRET = process.env.BETTER_AUTH_SECRET
const MANIFEST = '.next/server/server-reference-manifest.json'

// React's own encoder for Server Action arguments, as the browser uses it.
const { encodeReply } = createRequire(import.meta.url)(
  'next/dist/compiled/react-server-dom-webpack/client.node'
) as { encodeReply: (value: unknown) => Promise<string | FormData> }

const tag = `e2e${Date.now().toString(36)}`

// Better Auth only adds __Secure- when the app is served over https.
const SESSION_COOKIE = `${BASE?.startsWith('https://') ? '__Secure-' : ''}better-auth.session_token`

/** A session token signed the way Better Auth signs its cookie. */
function signedSessionCookie(token: string) {
  const signature = createHmac('sha256', SECRET!).update(token).digest('base64')
  return encodeURIComponent(`${token}.${signature}`)
}

// ---------------------------------------------------------------------------
// A browser-like client: keeps its own cookies, never follows redirects.
// ---------------------------------------------------------------------------

let clientCount = 0
// Random per run, so back-to-back runs do not share rate-limit buckets.
const runNet = Math.floor(Math.random() * 250)

class Client {
  cookies = new Map<string, string>()
  // Each client looks like its own IP, so Better Auth's per-IP rate limits
  // do not trip across unrelated tests.
  ip = `10.${runNet}.${Math.floor(++clientCount / 250)}.${clientCount % 250}`

  async fetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    headers.set('origin', BASE!)
    headers.set('x-forwarded-for', this.ip)
    if (this.cookies.size > 0) {
      headers.set(
        'cookie',
        [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
      )
    }
    const res = await fetch(new URL(path, BASE), {
      ...init,
      headers,
      redirect: 'manual'
    })
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';')
      const index = pair!.indexOf('=')
      const name = pair!.slice(0, index).trim()
      const value = pair!.slice(index + 1)
      const expired = attrs.some(a => /max-age=0\b/i.test(a)) || value === ''
      if (expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    return res
  }

  json(path: string, body: unknown) {
    return this.fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  async session() {
    const res = await this.fetch('/api/auth/get-session')
    return (await res.json()) as { user: { id: string; email: string } } | null
  }

  hasSessionCookie() {
    return [...this.cookies.keys()].some(k => k.endsWith('session_token'))
  }
}

// ---------------------------------------------------------------------------
// Server Actions, called the way the browser calls them.
// ---------------------------------------------------------------------------

type ManifestEntry = { exportedName: string; workers: Record<string, unknown> }

function loadActions() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as {
    node: Record<string, ManifestEntry>
  }
  const actions = new Map<string, { id: string; page: string }>()
  for (const [id, entry] of Object.entries(manifest.node)) {
    // Any page the action is registered on: one with no [params] if there is
    // one (an /identity page first), else e.g. /runs/[id] (filled in by
    // callAction).
    const pages = Object.keys(entry.workers)
      .filter(w => w.startsWith('app/') && w.endsWith('/page'))
      .map(
        w =>
          w
            .replace(/^app/, '')
            .replace(/\/page$/, '')
            .replace(/\/\([^)]+\)/g, '') || '/'
      )
      .sort(
        (a, b) =>
          Number(a.includes('[')) - Number(b.includes('[')) ||
          Number(!a.startsWith('/identity')) -
            Number(!b.startsWith('/identity'))
      )
    if (pages[0]) actions.set(entry.exportedName, { id, page: pages[0] })
  }
  return actions
}

let actions: Map<string, { id: string; page: string }>

/**
 * Calls a Server Action by its id, as the browser does. `pageParam` fills in
 * the [id] of the page it is posted to, if it has one; the action's own
 * arguments are what is being tested.
 */
async function callAction(
  client: Client,
  name: string,
  args: unknown[],
  pageParam = '00000000-0000-0000-0000-000000000000'
) {
  const action = actions.get(name)
  assert.ok(action, `Server Action ${name} not found in ${MANIFEST}`)
  const body = await encodeReply(args)
  const headers: Record<string, string> = {
    'next-action': action.id,
    accept: 'text/x-component'
  }
  if (typeof body === 'string')
    headers['content-type'] = 'text/plain;charset=UTF-8'
  const res = await client.fetch(
    action.page.replace(/\[[^\]]+\]/g, pageParam),
    {
      method: 'POST',
      headers,
      body
    }
  )
  return { status: res.status, text: await res.text(), headers: res.headers }
}

// ---------------------------------------------------------------------------

describe(
  'authentication and multi-user isolation (end to end)',
  { skip: !BASE || !DB_URL || !SECRET },
  () => {
    const client = postgres(DB_URL!, { max: 4, prepare: false })
    const db = drizzle(client, { schema })
    const emails = (suffix: string) => `${tag}-${suffix}@example.test`

    /**
     * A signed-in user, made directly in the database: the only ways to sign
     * in are Google and passkeys, which a test cannot drive.
     */
    async function signedInUser(suffix: string) {
      const [user] = await db
        .insert(schema.authUsersTable)
        .values({
          name: `User ${suffix}`,
          email: emails(suffix),
          emailVerified: true
        })
        .returning()
      const token = randomBytes(32).toString('base64url')
      await db.insert(schema.authSessionsTable).values({
        token,
        userId: user!.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      })
      const browser = new Client()
      browser.cookies.set(SESSION_COOKIE, signedSessionCookie(token))
      const session = await browser.session()
      assert.strictEqual(session?.user.id, user!.id)
      return { browser, userId: user!.id }
    }

    before(() => {
      actions = loadActions()
    })

    after(async () => {
      await db
        .delete(schema.authUsersTable)
        .where(like(schema.authUsersTable.email, `${tag}-%`))
      await client.end()
    })

    describe('sign-in', () => {
      it('has no password sign-up, sign-in or reset', async () => {
        const browser = new Client()
        for (const [path, body] of [
          [
            '/api/auth/sign-up/email',
            {
              name: 'No Passwords',
              email: emails('nopw'),
              password: 'x'.repeat(12)
            }
          ],
          [
            '/api/auth/sign-in/email',
            { email: emails('nopw'), password: 'x'.repeat(12) }
          ],
          ['/api/auth/request-password-reset', { email: emails('nopw') }]
        ] as const) {
          const res = await browser.json(path, body)
          assert.ok(res.status >= 400, `${path} answered ${res.status}`)
        }
        assert.strictEqual(browser.hasSessionCookie(), false)
        const [user] = await db
          .select()
          .from(schema.authUsersTable)
          .where(eq(schema.authUsersTable.email, emails('nopw')))
        assert.strictEqual(user, undefined)
      })

      it('offers passkey sign-in for this site', async () => {
        const res = await new Client().fetch(
          '/api/auth/passkey/generate-authenticate-options'
        )
        assert.strictEqual(res.status, 200)
        const options = (await res.json()) as { rpId: string }
        assert.strictEqual(options.rpId, new URL(BASE!).hostname)
      })

      it('only lets a signed-in user add a passkey', async () => {
        const res = await new Client().fetch(
          '/api/auth/passkey/generate-register-options'
        )
        assert.strictEqual(res.status, 401)
        const { browser } = await signedInUser('passkey')
        const own = await browser.fetch(
          '/api/auth/passkey/generate-register-options'
        )
        assert.strictEqual(own.status, 200)
      })

      it('sends ?next= only to paths inside the app', async () => {
        const { browser } = await signedInUser('next')
        for (const [next, expected] of [
          ['/runs?page=2', '/runs?page=2'],
          ['https://evil.example', '/'],
          ['//evil.example', '/'],
          ['/\\evil.example', '/']
        ]) {
          const res = await browser.fetch(
            `/login?next=${encodeURIComponent(next!)}`
          )
          assert.strictEqual(res.headers.get('location'), expected, next)
        }
      })

      it('starts Google sign-in with the account picker and the right callback', async () => {
        const res = await new Client().json('/api/auth/sign-in/social', {
          provider: 'google',
          callbackURL: '/'
        })
        const { url } = (await res.json()) as { url: string }
        const google = new URL(url)
        assert.strictEqual(google.hostname, 'accounts.google.com')
        assert.strictEqual(google.searchParams.get('prompt'), 'select_account')
        assert.strictEqual(
          google.searchParams.get('redirect_uri'),
          `${BASE}/api/auth/callback/google`
        )
      })

      it(
        'starts LinkedIn sign-in with OpenID scopes and the right callback',
        { skip: !process.env.LINKEDIN_CLIENT_ID },
        async () => {
          const res = await new Client().json('/api/auth/sign-in/social', {
            provider: 'linkedin',
            callbackURL: '/'
          })
          const { url } = (await res.json()) as { url: string }
          const linkedin = new URL(url)
          assert.strictEqual(linkedin.hostname, 'www.linkedin.com')
          assert.deepStrictEqual(
            linkedin.searchParams.get('scope')?.split(' ').sort(),
            ['email', 'openid', 'profile']
          )
          assert.strictEqual(
            linkedin.searchParams.get('redirect_uri'),
            `${BASE}/api/auth/callback/linkedin`
          )
        }
      )

      it('refuses a Google callback URL outside the app', async () => {
        const res = await new Client().json('/api/auth/sign-in/social', {
          provider: 'google',
          callbackURL: 'https://evil.example/'
        })
        assert.strictEqual(res.status, 403)
      })
    })

    describe('route protection', () => {
      it('sends visitors without a session to sign-in, keeping where they were going', async () => {
        const res = await new Client().fetch('/ideas?x=1')
        assert.strictEqual(res.status, 307)
        assert.strictEqual(
          res.headers.get('location'),
          '/login?next=%2Fideas%3Fx%3D1'
        )
      })

      it('does not trust a made-up session cookie', async () => {
        const browser = new Client()
        browser.cookies.set('better-auth.session_token', 'forged.value')
        browser.cookies.set(
          '__Secure-better-auth.session_token',
          'forged.value'
        )
        const res = await browser.fetch('/ideas')
        assert.ok([303, 307].includes(res.status), String(res.status))
        assert.match(res.headers.get('location') ?? '', /^\/login/)
        const api = await browser.fetch('/api/ai-setup/analyze', {
          method: 'POST',
          body: JSON.stringify({ description: 'x' })
        })
        assert.strictEqual(api.status, 401)
      })

      it('keeps only the sign-in page public', async () => {
        assert.strictEqual((await new Client().fetch('/login')).status, 200)
        for (const path of ['/signup', '/forgot-password', '/reset-password']) {
          const res = await new Client().fetch(path)
          assert.strictEqual(res.status, 307, path)
        }
      })
    })

    describe('sign-out', () => {
      it('ends the session on the server', async () => {
        const { browser } = await signedInUser('signout')
        const staleCookies = new Map(browser.cookies)

        const res = await callAction(browser, 'signOutAction', [])
        assert.strictEqual(
          res.headers.get('x-action-redirect')?.split(';')[0],
          '/login'
        )
        assert.strictEqual(browser.hasSessionCookie(), false)

        // Replaying the old cookie no longer works: the session row is gone.
        const replay = new Client()
        replay.cookies = staleCookies
        assert.strictEqual(await replay.session(), null)
        const page = await replay.fetch('/ideas')
        assert.match(page.headers.get('location') ?? '', /^\/login/)
      })
    })

    describe('one user cannot reach another user’s data', () => {
      let a: { browser: Client; userId: string }
      let b: { browser: Client; userId: string }
      const ids = {
        accountA: '',
        accountB: '',
        goalB: '',
        runB: '',
        ideaB: '',
        draftB: '',
        docB: '',
        mediaB: ''
      }
      const LEGACY = '11111111-1111-1111-1111-111111111111'

      before(async () => {
        a = await signedInUser('alice')
        b = await signedInUser('bob')
        const identity = (userId: string, name: string) => ({
          userId,
          name,
          handle: 'shared-handle',
          headline: 'QA',
          bio: 'QA bio',
          industry: 'Finance'
        })
        const [accountA] = await db
          .insert(schema.accountsTable)
          .values(identity(a.userId, `Alice Identity ${tag}`))
          .returning()
        const [accountB] = await db
          .insert(schema.accountsTable)
          .values(identity(b.userId, `Bob Identity ${tag}`))
          .returning()
        ids.accountA = accountA!.id
        ids.accountB = accountB!.id
        const [goal] = await db
          .insert(schema.goalsTable)
          .values({ accountId: ids.accountB, title: 'Bob goal' })
          .returning()
        const [run] = await db
          .insert(schema.runsTable)
          .values({ accountId: ids.accountB, status: 'awaiting_approval' })
          .returning()
        const [idea] = await db
          .insert(schema.ideasTable)
          .values({
            accountId: ids.accountB,
            runId: run!.id,
            hook: `Bob secret hook ${tag}`
          })
          .returning()
        const [draft] = await db
          .insert(schema.postDraftsTable)
          .values({
            accountId: ids.accountB,
            hook: 'Bob hook',
            body: 'Bob body',
            originalHook: 'Bob hook',
            originalBody: 'Bob body'
          })
          .returning()
        const [doc] = await db
          .insert(schema.knowledgeDocumentsTable)
          .values({
            accountId: ids.accountB,
            title: 'Bob doc',
            sourceType: 'artifact',
            content: 'secret'
          })
          .returning()
        const [media] = await db
          .insert(schema.postMediaTable)
          .values({
            draftId: draft!.id,
            mode: 'stock',
            imageUrl: 'https://example.test/bob.png'
          })
          .returning()
        Object.assign(ids, {
          goalB: goal!.id,
          runB: run!.id,
          ideaB: idea!.id,
          draftB: draft!.id,
          docB: doc!.id,
          mediaB: media!.id
        })
      })

      const callActionAsAlice = (name: string, args: unknown[]) =>
        callAction(a.browser, name, args, ids.accountA)

      it('lets two users have the same handle', async () => {
        const rows = await db
          .select({ id: schema.accountsTable.id })
          .from(schema.accountsTable)
          .where(inArray(schema.accountsTable.id, [ids.accountA, ids.accountB]))
        assert.strictEqual(rows.length, 2)
      })

      it('shows each user only their own identity', async () => {
        for (const path of [
          '/identity',
          '/identity/knowledge',
          '/identity/voice',
          '/identity/preferences',
          '/identity/runs',
          '/ideas'
        ]) {
          const res = await a.browser.fetch(path)
          assert.strictEqual(res.status, 200, path)
          const html = await res.text()
          assert.ok(html.includes(`Alice Identity ${tag}`), path)
          assert.ok(!html.includes(`Bob Identity ${tag}`), path)
          assert.ok(!html.includes(`Bob secret hook ${tag}`), path)
        }
        // Goals and Schedule name no identity; they must not show Bob's goal or posts.
        for (const path of ['/goals', '/schedule', '/runs']) {
          const res = await a.browser.fetch(path)
          assert.strictEqual(res.status, 200, path)
          const html = await res.text()
          assert.ok(!html.includes('Bob goal'), path)
          assert.ok(!html.includes(`Bob secret hook ${tag}`), path)
        }
      })

      it('404s another user’s run and the old per-identity URLs', async () => {
        for (const path of [
          `/runs/${ids.runB}`,
          `/accounts/${ids.accountB}`,
          `/accounts/${LEGACY}`
        ]) {
          const res = await a.browser.fetch(path)
          assert.strictEqual(res.status, 404, path)
          assert.ok(!(await res.text()).includes('Bob Identity'), path)
        }
        assert.strictEqual(
          (await b.browser.fetch(`/runs/${ids.runB}`)).status,
          200
        )
      })

      it('404s another user’s identity and post in API routes', async () => {
        const analyze = await a.browser.json('/api/ai-setup/analyze', {
          accountId: ids.accountB,
          description: 'Trying to analyze for someone else'
        })
        assert.strictEqual(analyze.status, 404)
        const media = await a.browser.json(`/api/posts/${ids.draftB}/media`, {
          prompt: 'A clean photo of a modern office with plants'
        })
        assert.strictEqual(media.status, 404)
        const image = await a.browser.fetch(`/api/media/${ids.mediaB}`)
        assert.strictEqual(image.status, 404)
        assert.doesNotMatch(await image.text(), /Bob/)
      })

      it('refuses Server Actions on another user’s identity', async () => {
        const profile = {
          name: 'Pwned',
          description: 'x',
          targetAudience: 'x',
          offerings: 'x',
          industry: 'x'
        }
        const goal = {
          title: 'Injected goal',
          objectiveType: 'awareness',
          keyMessage: 'x',
          linkStrategy: 'body'
        }
        const results = {
          updateAccountAction: await callActionAsAlice('updateAccountAction', [
            { id: ids.accountB, ...profile }
          ]),
          getIdentitySetupBaselineAction: await callActionAsAlice(
            'getIdentitySetupBaselineAction',
            [ids.accountB]
          ),
          saveSchedule: await callActionAsAlice('saveSchedule', [
            ids.accountB,
            { daysOfWeek: [1], timeOfDay: '09:00', enabled: true }
          ]),
          saveVoiceConfigAction: await callActionAsAlice(
            'saveVoiceConfigAction',
            [{ accountId: ids.accountB, tone: 'pwned' }]
          ),
          suggestGoalsAction: await callActionAsAlice('suggestGoalsAction', [
            ids.accountB
          ]),
          // Another user's goal cannot steer the caller's run.
          triggerNewRun: await callActionAsAlice('triggerNewRun', [
            [ids.goalB]
          ])
        }
        for (const [name, res] of Object.entries(results)) {
          assert.match(res.text, /"success":false/, name)
          assert.match(
            res.text,
            /not found/,
            `${name}: ${res.text.slice(0, 300)}`
          )
        }

        // These throw instead of returning an error; either way nothing changes.
        await callActionAsAlice('createGoal', [ids.accountB, goal])
        await callActionAsAlice('deleteGoal', [ids.goalB, ids.accountB])
        // Pairing the foreign goal with the user's own identity does not help.
        await callActionAsAlice('deleteGoal', [ids.goalB, ids.accountA])
        await callActionAsAlice('deleteKnowledgeDocument', [
          ids.docB,
          ids.accountB
        ])
        await callActionAsAlice('savePreferences', [
          ids.accountB,
          {
            ideasPerRun: 5,
            post_constraints: { cta_required: false },
            guardrails: { banned_topics: [], compliance_notes: '' }
          }
        ])

        const [account] = await db
          .select()
          .from(schema.accountsTable)
          .where(eq(schema.accountsTable.id, ids.accountB))
        assert.strictEqual(account!.name, `Bob Identity ${tag}`)
        const goals = await db
          .select()
          .from(schema.goalsTable)
          .where(eq(schema.goalsTable.accountId, ids.accountB))
        assert.deepStrictEqual(
          goals.map(g => g.id),
          [ids.goalB]
        )
        assert.strictEqual(
          (
            await db
              .select()
              .from(schema.knowledgeDocumentsTable)
              .where(eq(schema.knowledgeDocumentsTable.id, ids.docB))
          ).length,
          1
        )
        assert.strictEqual(
          (
            await db
              .select()
              .from(schema.preferencesTable)
              .where(eq(schema.preferencesTable.accountId, ids.accountB))
          ).length,
          0
        )
        assert.strictEqual(
          (
            await db
              .select()
              .from(schema.schedulesTable)
              .where(eq(schema.schedulesTable.accountId, ids.accountB))
          ).length,
          0
        )
        assert.strictEqual(
          (
            await db
              .select()
              .from(schema.voiceConfigsTable)
              .where(eq(schema.voiceConfigsTable.accountId, ids.accountB))
          ).length,
          0
        )
        assert.strictEqual(
          (
            await db
              .select()
              .from(schema.runsTable)
              .where(eq(schema.runsTable.accountId, ids.accountB))
          ).length,
          1
        )
      })

      it('refuses Server Actions on another user’s ideas, runs and posts', async () => {
        const calls: Array<[string, unknown[]]> = [
          ['approveIdea', [ids.ideaB]],
          ['rejectIdea', [ids.ideaB, 'nope']],
          ['editIdea', [ids.ideaB, { angle: 'pwned' }]],
          ['approveRunIdeas', [ids.runB, [ids.ideaB]]],
          ['draftSelectedIdeas', [{ runId: ids.runB, ideaIds: [ids.ideaB] }]],
          ['approveAllIdeas', [[ids.ideaB]]],
          ['fetchRunStatus', [ids.runB]],
          ['updateDraft', [ids.draftB, { hook: 'pwned' }]],
          ['approveDraft', [ids.draftB]],
          ['rejectDraft', [ids.draftB, 'nope']],
          ['removePostMediaAction', [ids.draftB]],
          ['updatePostMediaAction', [ids.draftB, { mode: 'none' }]]
        ]
        for (const [name, args] of calls) {
          const res = await callActionAsAlice(name, args)
          assert.match(res.text, /"success":false/, name)
          assert.doesNotMatch(res.text, /Bob/, name)
        }
        const [idea] = await db
          .select()
          .from(schema.ideasTable)
          .where(eq(schema.ideasTable.id, ids.ideaB))
        assert.strictEqual(idea!.status, 'proposed')
        assert.strictEqual(idea!.angle, null)
        const [draft] = await db
          .select()
          .from(schema.postDraftsTable)
          .where(eq(schema.postDraftsTable.id, ids.draftB))
        assert.strictEqual(draft!.hook, 'Bob hook')
        assert.strictEqual(draft!.status, 'draft')
        assert.strictEqual(
          (
            await db
              .select()
              .from(schema.postMediaTable)
              .where(eq(schema.postMediaTable.draftId, ids.draftB))
          ).length,
          1
        )
      })

      it('never creates a second identity, whatever the form says', async () => {
        const form = new FormData()
        for (const [key, value] of Object.entries({
          name: `Created ${tag}`,
          description: 'd',
          targetAudience: 't',
          offerings: 'o',
          industry: 'i',
          linkedinUrl: 'https://www.linkedin.com/in/shared-handle',
          userId: b.userId
        })) {
          form.set(key, value)
        }
        // Alice already has her identity, so she is sent to it instead.
        const res = await callActionAsAlice('createAccount', [form])
        assert.match(
          res.text,
          /"redirectTo":"\/identity"/,
          res.text.slice(0, 300)
        )
        const created = await db
          .select()
          .from(schema.accountsTable)
          .where(eq(schema.accountsTable.name, `Created ${tag}`))
        assert.strictEqual(created.length, 0)
      })

      it('still lets owners use the same actions on their own data', async () => {
        // The control for the refusals above: same actions, the caller's own ids.
        const schedule = await callAction(
          b.browser,
          'saveSchedule',
          [
            ids.accountB,
            { daysOfWeek: [2], timeOfDay: '10:00', enabled: false }
          ],
          ids.accountB
        )
        assert.match(
          schedule.text,
          /"success":true/,
          schedule.text.slice(0, 300)
        )
        const approve = await callAction(
          b.browser,
          'approveIdea',
          [ids.ideaB],
          ids.accountB
        )
        assert.match(approve.text, /"success":true/, approve.text.slice(0, 300))
        const [idea] = await db
          .select()
          .from(schema.ideasTable)
          .where(eq(schema.ideasTable.id, ids.ideaB))
        assert.strictEqual(idea!.status, 'approved')
        // Put it back for any later checks.
        await db
          .update(schema.ideasTable)
          .set({ status: 'proposed' })
          .where(eq(schema.ideasTable.id, ids.ideaB))
      })

      it('refuses Server Actions without a valid session', async () => {
        const stranger = new Client()
        stranger.cookies.set('better-auth.session_token', 'forged.value')
        const res = await callAction(stranger, 'approveIdea', [ids.ideaB])
        assert.match(res.headers.get('x-action-redirect') ?? '', /^\/login/)
        const [idea] = await db
          .select()
          .from(schema.ideasTable)
          .where(eq(schema.ideasTable.id, ids.ideaB))
        assert.strictEqual(idea!.status, 'proposed')
      })
    })

    describe('existing flows keep working for an identity’s owner', () => {
      const ZERO = '00000000-0000-0000-0000-000000000000'
      let owner: { browser: Client; userId: string }
      let accountId = ''
      const name = `Owner Identity ${tag}`
      const act = (action: string, args: unknown[]) =>
        callAction(owner.browser, action, args, accountId || ZERO)
      /** What the action returned; fails if it threw. */
      const value = (res: { text: string }) => {
        const line = res.text.match(/^1:(?!E\{)(.*)$/m)
        assert.ok(line, `no return value: ${res.text.slice(0, 300)}`)
        return JSON.parse(line[1]!)
      }
      const threw = (res: { text: string }) => /^1:E\{/m.test(res.text)
      const profile = {
        name,
        description: 'We help finance teams close the books faster.',
        targetAudience: 'CFOs at mid-size companies',
        offerings: 'Close automation software',
        industry: 'Finance'
      }
      const goal = {
        title: 'Grow pipeline',
        objectiveType: 'lead_gen',
        keyMessage: 'Month-end close does not have to hurt.',
        linkStrategy: 'first_comment'
      }

      before(async () => {
        owner = await signedInUser('owner')
      })

      it('shows the empty workspace before the first identity', async () => {
        for (const path of ['/', '/ideas', '/posts', '/runs', '/identity']) {
          assert.strictEqual(
            (await owner.browser.fetch(path)).status,
            200,
            path
          )
        }
        const ideas = await (await owner.browser.fetch('/ideas')).text()
        assert.ok(ideas.includes('No identity yet'))
        // The other setup steps wait for the identity to exist.
        const voice = await owner.browser.fetch('/identity/voice')
        assert.strictEqual(voice.status, 307)
        assert.strictEqual(voice.headers.get('location'), '/identity')
      })

      it('creates the identity the way the create page does, only once', async () => {
        const form = new FormData()
        for (const [key, val] of Object.entries({
          ...profile,
          accountType: 'company',
          linkedinUrl: `https://www.linkedin.com/company/${tag}-owner`
        })) {
          form.set(key, val)
        }
        const first = value(await act('createAccount', [form]))
        assert.strictEqual(first.redirectTo, '/identity/voice')
        // A repeat (second click, another tab) creates nothing.
        const repeat = value(await act('createAccount', [form]))
        assert.strictEqual(repeat.redirectTo, '/identity')

        const rows = await db
          .select()
          .from(schema.accountsTable)
          .where(eq(schema.accountsTable.name, name))
        assert.strictEqual(rows.length, 1)
        accountId = rows[0]!.id
        assert.strictEqual(rows[0]!.userId, owner.userId)
        assert.strictEqual(rows[0]!.accountType, 'company')
        assert.strictEqual(rows[0]!.handle, `${tag}-owner`)
        assert.strictEqual(
          (
            await db
              .select()
              .from(schema.offeringsTable)
              .where(eq(schema.offeringsTable.accountId, accountId))
          ).length,
          1
        )
        assert.strictEqual(
          (
            await db
              .select()
              .from(schema.audiencesTable)
              .where(eq(schema.audiencesTable.accountId, accountId))
          ).length,
          1
        )
      })

      it('serves every setup page', async () => {
        for (const step of [
          '',
          '/knowledge',
          '/voice',
          '/preferences',
          '/runs'
        ]) {
          const res = await owner.browser.fetch(`/identity${step}`)
          assert.strictEqual(res.status, 200, step)
        }
        // Goals and Schedule left Account Setup; their old links redirect.
        for (const page of ['/goals', '/schedule']) {
          const res = await owner.browser.fetch(page)
          assert.strictEqual(res.status, 200, page)
          const moved = await owner.browser.fetch(`/identity${page}`)
          assert.match(moved.headers.get('location') ?? '', new RegExp(`${page}$`))
        }
        assert.ok(
          (await (await owner.browser.fetch('/')).text()).includes(name)
        )
      })

      it('saves the profile, voice, goals, knowledge, preferences and schedule', async () => {
        const renamed = `${name} Renamed`
        assert.strictEqual(
          value(
            await act('updateAccountAction', [
              { id: accountId, ...profile, name: renamed }
            ])
          ).success,
          true
        )
        const [account] = await db
          .select()
          .from(schema.accountsTable)
          .where(eq(schema.accountsTable.id, accountId))
        assert.strictEqual(account!.name, renamed)

        const voice = value(
          await act('saveVoiceConfigAction', [
            {
              accountId,
              tone: 'candid',
              rawSamplesText:
                'The first sample post, long enough to keep.\n---\nThe second sample post, long enough to keep.'
            }
          ])
        )
        assert.strictEqual(voice.success, true, JSON.stringify(voice))
        assert.strictEqual(
          (
            await db
              .select()
              .from(schema.samplePostsTable)
              .where(eq(schema.samplePostsTable.accountId, accountId))
          ).length,
          2
        )

        assert.deepStrictEqual(
          value(await act('createGoal', [accountId, goal])),
          { success: true }
        )
        assert.ok(
          threw(await act('createGoal', [accountId, goal])),
          'a second goal with the same title is refused'
        )
        const [saved] = await db
          .select()
          .from(schema.goalsTable)
          .where(eq(schema.goalsTable.accountId, accountId))
        assert.strictEqual(
          value(
            await act('updateGoal', [
              saved!.id,
              accountId,
              { ...goal, title: 'Renamed goal' }
            ])
          ).success,
          true
        )
        const [toggled] = await db
          .select()
          .from(schema.goalsTable)
          .where(eq(schema.goalsTable.id, saved!.id))
        assert.strictEqual(toggled!.title, 'Renamed goal')
        assert.strictEqual(
          value(await act('deleteGoal', [saved!.id, accountId])).success,
          true
        )
        assert.strictEqual(
          (
            await db
              .select()
              .from(schema.goalsTable)
              .where(eq(schema.goalsTable.accountId, accountId))
          ).length,
          0
        )

        const doc = value(
          await act('saveKnowledgeDocument', [
            {
              accountId,
              title: 'Close checklist',
              sourceType: 'artifact',
              content:
                'Teams that reconcile daily close the books in three days instead of ten.'
            }
          ])
        )
        assert.strictEqual(doc.success, true)
        assert.strictEqual(
          (
            await db
              .select()
              .from(schema.knowledgeDocumentsTable)
              .where(eq(schema.knowledgeDocumentsTable.id, doc.docId))
          ).length,
          1
        )
        assert.strictEqual(
          value(await act('deleteKnowledgeDocument', [doc.docId, accountId]))
            .success,
          true
        )
        assert.strictEqual(
          (
            await db
              .select()
              .from(schema.knowledgeDocumentsTable)
              .where(eq(schema.knowledgeDocumentsTable.id, doc.docId))
          ).length,
          0
        )

        assert.strictEqual(
          value(
            await act('savePreferences', [
              accountId,
              {
                // An old client still sending pillars is accepted; they are not saved.
                pillars: [{ name: 'Close', weight_pct: 1 }],
                ideasPerRun: 5,
                post_constraints: { cta_required: true },
                guardrails: {
                  banned_topics: ['Crypto', 'crypto', ' '],
                  compliance_notes: ''
                }
              }
            ])
          ).success,
          true
        )
        const [prefs] = await db
          .select()
          .from(schema.preferencesTable)
          .where(eq(schema.preferencesTable.accountId, accountId))
        assert.deepStrictEqual(prefs!.pillars, [])
        assert.deepStrictEqual(prefs!.guardrails!.banned_topics, ['Crypto'])

        assert.strictEqual(
          value(
            await act('saveSchedule', [
              accountId,
              { daysOfWeek: [1, 3], timeOfDay: '08:30', enabled: true }
            ])
          ).success,
          true
        )
        const [schedule] = await db
          .select()
          .from(schema.schedulesTable)
          .where(eq(schema.schedulesTable.accountId, accountId))
        assert.strictEqual(schedule!.timeOfDay, '08:30')

        const baseline = value(
          await act('getIdentitySetupBaselineAction', [accountId])
        )
        assert.strictEqual(baseline.success, true)
        assert.strictEqual(baseline.data.profile.name, renamed)
        assert.strictEqual(baseline.data.hasVoice, true)
        assert.strictEqual(baseline.data.hasPreferences, true)
      })

      it('reviews the ideas of a run', async () => {
        const [run] = await db
          .insert(schema.runsTable)
          .values({ accountId, status: 'awaiting_approval' })
          .returning()
        const ideaRows = await db
          .insert(schema.ideasTable)
          .values(
            ['one', 'two', 'three'].map(n => ({
              accountId,
              runId: run!.id,
              hook: `Hook ${n} ${tag}`
            }))
          )
          .returning()
        const [one, two, three] = ideaRows.map(i => i.id)

        assert.strictEqual(value(await act('approveIdea', [one])).success, true)
        assert.strictEqual(
          value(await act('rejectIdea', [two, 'Off topic'])).success,
          true
        )
        assert.strictEqual(
          value(await act('editIdea', [three, { angle: 'A sharper angle' }]))
            .success,
          true
        )
        assert.deepStrictEqual(
          value(await act('approveAllIdeas', [[three]])).approvedIds,
          [three]
        )
        assert.strictEqual(
          value(await act('approveRunIdeas', [run!.id, [one]])).success,
          true
        )

        const after = await db
          .select()
          .from(schema.ideasTable)
          .where(eq(schema.ideasTable.runId, run!.id))
        const byId = new Map(after.map(i => [i.id, i]))
        assert.strictEqual(byId.get(one!)!.status, 'approved')
        assert.strictEqual(byId.get(two!)!.status, 'rejected')
        assert.strictEqual(byId.get(three!)!.status, 'approved')
        assert.strictEqual(byId.get(three!)!.angle, 'A sharper angle')
        const feedback = await db
          .select()
          .from(schema.feedbackTable)
          .where(eq(schema.feedbackTable.accountId, accountId))
        assert.ok(feedback.some(f => f.reasonText === 'Off topic'))

        const status = value(await act('fetchRunStatus', [run!.id]))
        assert.strictEqual(status.success, true)
        assert.strictEqual(status.ideas.length, 3)
        const page = await owner.browser.fetch(`/runs/${run!.id}`)
        assert.strictEqual(page.status, 200)
        assert.ok((await page.text()).includes(`Hook one ${tag}`))
        assert.strictEqual(
          (await owner.browser.fetch('/ideas?status=approved')).status,
          200
        )
      })

      it('edits, approves and rejects posts and their media', async () => {
        const drafts = await db
          .insert(schema.postDraftsTable)
          .values(
            ['one', 'two'].map(n => ({
              accountId,
              hook: `Post ${n}`,
              body: 'Body text.',
              originalHook: `Post ${n}`,
              originalBody: 'Body text.'
            }))
          )
          .returning()
        const [d1, d2] = drafts.map(d => d.id)

        const updated = value(
          await act('updateDraft', [d1, { hook: `Edited hook ${tag}` }])
        )
        assert.strictEqual(updated.success, true)
        assert.strictEqual(typeof updated.charCount, 'number')
        assert.strictEqual(value(await act('approveDraft', [d1])).success, true)
        assert.strictEqual(
          value(await act('rejectDraft', [d2, 'Too long'])).success,
          true
        )
        const rows = new Map(
          (
            await db
              .select()
              .from(schema.postDraftsTable)
              .where(eq(schema.postDraftsTable.accountId, accountId))
          ).map(d => [d.id, d])
        )
        assert.strictEqual(rows.get(d1!)!.hook, `Edited hook ${tag}`)
        assert.strictEqual(rows.get(d1!)!.status, 'approved')
        assert.strictEqual(rows.get(d2!)!.status, 'rejected')

        const media = value(
          await act('updatePostMediaAction', [
            d1,
            {
              mode: 'stock',
              imageUrl: 'https://images.example.com/photo.png',
              altText: 'A photo'
            }
          ])
        )
        assert.strictEqual(media.success, true)
        const imageRes = await owner.browser.fetch(`/api/media/${media.media.id}`)
        assert.strictEqual(imageRes.status, 200)
        const image = (await imageRes.json()) as { imageUrl: string }
        assert.strictEqual(
          image.imageUrl,
          'https://images.example.com/photo.png'
        )
        assert.strictEqual(
          value(await act('removePostMediaAction', [d1])).success,
          true
        )
        assert.strictEqual(
          (
            await db
              .select()
              .from(schema.postMediaTable)
              .where(eq(schema.postMediaTable.draftId, d1!))
          ).length,
          0
        )
        assert.strictEqual(
          value(await act('loadMorePosts', [d1])).success,
          true
        )

        const posts = await owner.browser.fetch('/posts')
        assert.strictEqual(posts.status, 200)
        assert.ok((await posts.text()).includes(`Edited hook ${tag}`))
      })

      it('starts a run for the identity', async () => {
        // Safety: this server must have no AI keys, so the run cannot spend money.
        const dashboard = await (await owner.browser.fetch('/')).text()
        assert.ok(
          dashboard.includes('ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY'),
          'AI looks configured; not starting a run'
        )
        // A run needs at least one goal.
        const none = value(
          await callAction(owner.browser, 'triggerNewRun', [[]])
        )
        assert.strictEqual(none.success, false)
        assert.match(none.error, /at least one goal/)

        const goalPayload = {
          title: `Run goal ${tag}`,
          objectiveType: 'authority',
          keyMessage: 'Close the books in days, not weeks.',
          linkStrategy: 'first_comment'
        }
        for (const active of [false, true]) {
          assert.strictEqual(
            value(
              await callAction(owner.browser, 'createGoal', [
                accountId,
                { ...goalPayload, title: `${goalPayload.title} ${active}` },
                { active }
              ])
            ).success,
            true
          )
        }
        const goals = await db
          .select({ id: schema.goalsTable.id, isActive: schema.goalsTable.isActive })
          .from(schema.goalsTable)
          .where(eq(schema.goalsTable.accountId, accountId))
        const paused = goals.find(g => !g.isActive)!
        const active = goals.find(g => g.isActive)!

        // A paused goal never steers a run.
        const refused = value(
          await callAction(owner.browser, 'triggerNewRun', [[paused.id]])
        )
        assert.strictEqual(refused.success, false)
        assert.match(refused.error, /paused/)

        const res = value(
          await callAction(owner.browser, 'triggerNewRun', [[active.id]])
        )
        assert.strictEqual(res.success, true, JSON.stringify(res))
        const [run] = await db
          .select()
          .from(schema.runsTable)
          .where(eq(schema.runsTable.id, res.runId))
        assert.strictEqual(run!.accountId, accountId)
        assert.strictEqual(run!.trigger, 'manual')
        assert.deepStrictEqual(run!.goalIds, [active.id])
      })

      it('reaches the API routes for the user’s own data', async () => {
        // No AI keys, so both stop at the provider, past every auth and ownership check.
        const analyze = await owner.browser.json('/api/ai-setup/analyze', {
          accountId,
          description: 'A finance software company.'
        })
        assert.ok(
          ![401, 403, 404].includes(analyze.status),
          String(analyze.status)
        )
        const [draft] = await db
          .select()
          .from(schema.postDraftsTable)
          .where(eq(schema.postDraftsTable.accountId, accountId))
        const media = await owner.browser.json(
          `/api/posts/${draft!.id}/media`,
          { prompt: 'A calm, modern finance office at dusk' }
        )
        assert.ok(
          ![401, 403, 404].includes(media.status),
          `${media.status} ${await media.text()}`
        )
      })
    })

    describe('admin groundwork', () => {
      it('keeps admin endpoints and roles out of normal users’ reach', async () => {
        const { browser, userId } = await signedInUser('notadmin')
        const setRole = await browser.json('/api/auth/admin/set-role', {
          userId,
          role: 'admin'
        })
        assert.ok([401, 403].includes(setRole.status), String(setRole.status))
        const list = await browser.fetch('/api/auth/admin/list-users')
        assert.ok([401, 403].includes(list.status), String(list.status))
        await browser.json('/api/auth/update-user', {
          role: 'admin',
          name: 'Still Me'
        })
        const [user] = await db
          .select()
          .from(schema.authUsersTable)
          .where(eq(schema.authUsersTable.id, userId))
        assert.strictEqual(user!.role, 'user')
      })

      it('lets an admin use the admin endpoints', async () => {
        const { browser, userId } = await signedInUser('admin')
        // The reviewed database update from docs/AUTHENTICATION.md.
        await db
          .update(schema.authUsersTable)
          .set({ role: 'admin' })
          .where(eq(schema.authUsersTable.id, userId))
        const list = await browser.fetch('/api/auth/admin/list-users?limit=1')
        assert.strictEqual(list.status, 200)
      })
    })
  }
)
