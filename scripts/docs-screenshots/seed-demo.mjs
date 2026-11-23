// Seeds the fictional demo workspace the help-doc screenshots show, through
// the real UI (so it looks like a customer's): Alex Morgan's identity
// "Northwind Studio", a small product-design studio that helps SaaS startups
// with onboarding and activation, posting on LinkedIn, X and Threads.
//
//   node --env-file=.env scripts/docs-screenshots/demo-user.mjs   (user + cookie)
//   node --env-file=.env scripts/docs-screenshots/seed-demo.mjs   (everything below)
//   node --env-file=.env scripts/docs-screenshots/seed-demo.mjs --only goals,run
//
// Phases, in order (each is skipped when its data already exists, so a rerun
// only does what is missing): identity, voice, knowledge, goals, preferences,
// brand, run, review, posts, approve.
//
// COST (real AI through the gateway, recorded in ai_usage for the demo user):
// about $0.60–$1.00 on a fresh database. The paid parts are the knowledge
// item's summary (~$0.01), one idea run for two goals (web research + ideas,
// ~$0.25–$0.40), writing the posts (~$0.03 each), one LinkedIn image
// (~$0.13) and one carousel (~$0.15). The identity is filled in by hand
// ("I'll fill it in myself"), no profile links or website are given (so no
// public page is fetched or analysed), and Buffer is left unconnected. The
// script stops before a paid phase once the user has spent SPEND_CAP_USD
// (default 1.50).
import postgres from 'postgres'
import { BASE, openBrowser, readSession } from './lib.mjs'

const PHASES = ['identity', 'voice', 'knowledge', 'goals', 'preferences', 'brand', 'run', 'review', 'posts', 'approve']
const onlyArg = process.argv.find(a => a.startsWith('--only'))
const only = onlyArg
  ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : process.argv[process.argv.indexOf(onlyArg) + 1]).split(',')
  : PHASES
const SPEND_CAP_USD = Number(process.env.SPEND_CAP_USD ?? 1.5)

const IDENTITY = {
  name: 'Northwind Studio',
  industry: 'SaaS onboarding, product activation and UX design',
  description:
    'Northwind Studio is a small product-design studio. We help early-stage SaaS startups redesign onboarding so more new sign-ups reach their first success, and we share what we learn from activation audits and usability tests.',
  targetAudience: 'Founders and product leads at seed to Series B SaaS startups',
  offerings: 'Onboarding audits, activation design sprints, and design-partner engagements for SaaS teams',
  about:
    'Northwind Studio is a five-person product-design studio. We help SaaS startups fix onboarding and activation, and we post practical lessons from our audits for SaaS founders and product leads.'
}

const GOALS = [
  {
    title: 'Build authority with SaaS founders',
    belief: 'Most SaaS churn starts in the first session: fixing onboarding beats adding features.'
  },
  {
    title: 'Win design-partner clients',
    belief: 'A two-week activation sprint shows more than a quarter of roadmap debates.'
  }
]

const KNOWLEDGE = {
  title: 'Case study: Trellis onboarding redesign',
  text: `Client: Trellis (fictional example), a project-planning SaaS for small agencies.

Problem: 62% of new sign-ups never created their first project. The empty dashboard asked for ten settings before showing any value.

What we did in a two-week activation sprint:
- Watched 12 recorded first sessions and mapped where people stalled.
- Replaced the settings wizard with a sample project that new users can edit straight away.
- Moved team invites to after the first project is shared.
- Rewrote the three onboarding emails around one next step each.

Result after six weeks: first-project rate went from 38% to 61%, and trial-to-paid conversion rose from 9% to 13%.

Lesson: show the product working before asking for setup. Every question on day one has to earn its place.`
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} })
const session = readSession()

async function identityId() {
  const [row] = await sql`select id from accounts where user_id = ${session.userId} order by created_at limit 1`
  return row?.id ?? null
}
async function spent() {
  const [row] = await sql`select coalesce(sum(cost_usd), 0)::float as usd from ai_usage where user_id = ${session.userId}`
  return row.usd
}
async function guardSpend(what) {
  const usd = await spent()
  console.log(`  spend so far $${usd.toFixed(3)}`)
  if (usd >= SPEND_CAP_USD) throw new Error(`Spend cap $${SPEND_CAP_USD} reached before ${what}`)
}

const { browser, page, errors } = await openBrowser()
page.setDefaultTimeout(20_000)
const shot = name => page.screenshot({ path: `/tmp/docs-shots/seed-${name}.png` })

async function settle(ms = 600) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(ms)
}

const phases = {
  async identity() {
    if (await identityId()) return console.log('  identity exists, skipped')
    await page.goto(`${BASE}/identity`)
    // A half-typed wizard from an earlier attempt is kept in localStorage.
    const startOver = page.getByRole('button', { name: 'Start over' })
    if (await startOver.count()) await startOver.click()
    for (const name of [/LinkedIn/, /^X/, /Threads/]) await page.getByRole('checkbox', { name }).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.locator('#about-description').fill(IDENTITY.about)
    await page.getByRole('button', { name: "I'll fill it in myself" }).click()
    await page.getByRole('radio', { name: /A brand/ }).or(page.getByRole('button', { name: /A brand/ })).first().click()
    await page.locator('#name').fill(IDENTITY.name)
    await page.locator('#industry').fill(IDENTITY.industry)
    await page.locator('#description').fill(IDENTITY.description)
    await page.locator('#targetAudience').fill(IDENTITY.targetAudience)
    await page.locator('#offerings').fill(IDENTITY.offerings)
    await settle(300)
    await shot('identity-review')
    await page.getByRole('button', { name: 'Create identity' }).last().click()
    await page.waitForURL(url => url.pathname !== '/identity', { timeout: 30_000 })
    console.log('  created; now on', page.url())
  },

  async voice() {
    const id = await identityId()
    const [row] = await sql`select tone from voice_configs where account_id = ${id}`
    if (row?.tone) return console.log('  voice saved before, skipped')
    await page.goto(`${BASE}/identity/voice`)
    const pick = (group, name) => page.getByRole('radiogroup', { name: group }).getByRole('radio', { name })
    await pick('Writing style', /Educational/).click()
    await pick('Who is speaking', 'My team').click()
    await pick('Formality', 'Balanced').click()
    await pick('Directness', 'Punchy').click()
    await pick('Emoji', 'None').click()
    await pick('Hashtags', 'Up to 3').click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await waitForRow(() => sql`select id from voice_configs where account_id = ${id} and tone is not null`)
    await shot('voice-saved')
  },

  async knowledge() {
    const id = await identityId()
    const [row] = await sql`select id from knowledge_documents where account_id = ${id} limit 1`
    if (row) return console.log('  a knowledge item exists, skipped')
    await guardSpend('the knowledge item')
    await page.goto(`${BASE}/identity/knowledge`)
    await page.getByRole('button', { name: 'Paste text' }).click()
    await page.getByPlaceholder('e.g. Customer case study').fill(KNOWLEDGE.title)
    await page.getByPlaceholder(/Paste a case study/).fill(KNOWLEDGE.text)
    await page.getByRole('button', { name: 'Save', exact: true }).last().click()
    // Saving summarises the text (AI) and indexes it.
    await waitForRow(() => sql`select id from knowledge_documents where account_id = ${id}`, 120_000)
    await settle(1500)
    await shot('knowledge-saved')
  },

  async goals() {
    const id = await identityId()
    const existing = await sql`select title from goals where account_id = ${id}`
    for (const goal of GOALS) {
      if (existing.some(g => g.title === goal.title)) {
        console.log(`  goal "${goal.title}" exists, skipped`)
        continue
      }
      await page.goto(`${BASE}/goals`)
      const title = page.getByPlaceholder('e.g. Become known for our core expertise')
      if (!(await title.isVisible())) await page.getByRole('button', { name: /New Goal/ }).first().click()
      await title.fill(goal.title)
      await page.getByPlaceholder(/Most teams fix this problem/).fill(goal.belief)
      if (goal === GOALS[1]) {
        await page.locator('select').filter({ has: page.locator('option[value="lead_gen"]') }).selectOption('lead_gen')
        await page.getByPlaceholder('e.g. Comment with your experience').fill('Book a free 20-minute onboarding review')
      }
      await page.getByRole('button', { name: /Save Goal/ }).click()
      await waitForRow(() => sql`select id from goals where account_id = ${id} and title = ${goal.title}`)
      console.log(`  goal "${goal.title}" saved`)
    }
    await page.goto(`${BASE}/goals`)
    await settle()
    await shot('goals-saved')
  },

  async preferences() {
    const id = await identityId()
    const [row] = await sql`select ideas_per_run, guardrails from preferences where account_id = ${id}`
    if (row && JSON.stringify(row.guardrails ?? {}).includes('competitor')) return console.log('  preferences saved before, skipped')
    await page.goto(`${BASE}/identity/preferences`)
    const edit = page.getByRole('button', { name: 'Edit', exact: true })
    if (await edit.count()) await edit.click()
    await page.locator('select').filter({ has: page.locator('option', { hasText: '12 ideas' }) }).selectOption('4')
    await page.getByPlaceholder('e.g. politics, competitor pricing').fill('competitor pricing, client names')
    await page
      .getByPlaceholder('e.g. Never mention client names without approval.')
      .fill('Never name a client without written approval. Share numbers as ranges unless the case study is public.')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await waitForRow(() => sql`select id from preferences where account_id = ${id} and guardrails::text like '%competitor%'`)
    await shot('preferences-saved')
  },

  async brand() {
    const id = await identityId()
    const [row] = await sql`select primary_color from brand_themes where account_id = ${id}`
    if (row?.primary_color) return console.log('  brand theme saved before, skipped')
    await page.goto(`${BASE}/brand`)
    await page.locator('#brand-primary').fill('#0F766E')
    await page.locator('#brand-accent').fill('#14B8A6')
    await page.locator('#brand-background').fill('#F0FDFA')
    await page.getByRole('radiogroup', { name: 'Image style' }).getByRole('radio', { name: /Photorealistic/ }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByRole('button', { name: 'Saved' }).waitFor()
    await shot('brand-saved')
  },

  // One real idea run for both goals (web research + ideas), followed to
  // the end on its page.
  async run() {
    const id = await identityId()
    let [run] = await sql`select id, status from runs where account_id = ${id} order by created_at limit 1`
    if (!run) {
      await guardSpend('the idea run')
      await page.goto(`${BASE}/goals`)
      await page.getByRole('button', { name: /^Generate ideas/ }).first().click()
      const dialog = page.getByRole('dialog', { name: 'Generate ideas' })
      await dialog.waitFor()
      const selectAll = dialog.getByRole('button', { name: 'Select all' })
      if (await selectAll.count()) await selectAll.click()
      await dialog.getByRole('button', { name: 'Generate for 2 goals' }).click()
      await page.waitForURL(/\/runs\/[0-9a-f-]{36}/, { timeout: 30_000 })
      console.log('  run started', page.url())
      ;[run] = await sql`select id, status from runs where account_id = ${id} order by created_at limit 1`
    }
    const start = Date.now()
    let last = ''
    while (['queued', 'running', 'researching', 'ideating'].includes(run.status)) {
      if (Date.now() - start > 15 * 60_000) throw new Error('The run took over 15 minutes')
      await page.waitForTimeout(5000)
      ;[run] = await sql`select id, status, current_step, total_steps from runs where id = ${run.id}`
      const now = `${run.status} ${run.current_step ?? ''}/${run.total_steps ?? ''}`
      if (now !== last) console.log(`  ${Math.round((Date.now() - start) / 1000)}s ${now}`)
      last = now
    }
    if (!['awaiting_idea_approval', 'completed'].includes(run.status)) throw new Error(`The run ended ${run.status} (${run.id})`)
    const [{ n }] = await sql`select count(*)::int as n from ideas where run_id = ${run.id}`
    console.log(`  run ${run.id} ${run.status}, ${n} ideas`)
  }
}

async function waitForRow(query, timeout = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if ((await query()).length) return
    await page.waitForTimeout(500)
  }
  throw new Error('Timed out waiting for the saved row')
}

try {
  for (const phase of PHASES) {
    if (!only.includes(phase)) continue
    if (!phases[phase]) {
      console.log(`▶ ${phase}: not written yet`)
      continue
    }
    console.log(`▶ ${phase}`)
    await phases[phase]()
  }
  console.log('identity', await identityId(), `total spend $${(await spent()).toFixed(3)}`)
} catch (err) {
  await shot('error').catch(() => {})
  throw err
} finally {
  if (errors.length) console.log('Browser errors:\n' + errors.join('\n'))
  await browser.close()
  await sql.end()
}
