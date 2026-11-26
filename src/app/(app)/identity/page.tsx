import { SetupShell } from '@/components/account-setup/setup-shell'
import { SETUP_STEPS } from '@/components/account-setup/steps'
import { db } from '@/db'
import {
  audiencesTable,
  goalsTable,
  knowledgeDocumentsTable,
  offeringsTable,
  preferencesTable,
  voiceConfigsTable
} from '@/db/schema'
import { resolveChannels } from '@/lib/formats'
import { getIdentity, IDENTITY_PATH } from '@/lib/identity'
import { unrelatedLinks } from '@/lib/identity-change'
import { profileInsightViews } from '@/lib/profile-insights/analyze'
import { exampleViews } from '@/lib/visual-examples/store'
import { usesLearnedLink } from '@/lib/profile-insights/in-use'
import { profileLinksOf } from '@/lib/profile-links'
import { asc, eq } from 'drizzle-orm'
import { ArrowRight, ArrowRightLeft, Check, Play, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { CreateIdentity } from './create-identity'
import { EditIdentityForm } from './edit-identity-form'

/** The steps whose saved data makes the account ready to generate. */
const CONFIGURED_STEPS = SETUP_STEPS.filter(step =>
  ['voice', 'knowledge', 'goals', 'preferences'].includes(step.key)
)

export default async function IdentityPage() {
  // Before the user has an identity, this page is where they create it.
  const account = await getIdentity()
  if (!account) return <CreateIdentity />
  const id = account.id
  // These are only checked for existence, so only their ids are read (a
  // knowledge document's row carries its full text). Preferences also say
  // where the identity posts, which decides its profile link fields.
  const [
    voiceConfig,
    knowledgeDoc,
    goal,
    preference,
    offerings,
    audiences,
    insights,
    examples
  ] = await Promise.all([
      db.query.voiceConfigsTable.findFirst({
        columns: { id: true },
        where: eq(voiceConfigsTable.accountId, id)
      }),
      db.query.knowledgeDocumentsTable.findFirst({
        columns: { id: true },
        where: eq(knowledgeDocumentsTable.accountId, id)
      }),
      db.query.goalsTable.findFirst({
        columns: { id: true },
        where: eq(goalsTable.accountId, id)
      }),
      db.query.preferencesTable.findFirst({
        columns: { id: true, enabledFormats: true },
        where: eq(preferencesTable.accountId, id)
      }),
      db.query.offeringsTable.findMany({
        where: eq(offeringsTable.accountId, id),
        orderBy: [asc(offeringsTable.createdAt)]
      }),
      db.query.audiencesTable.findMany({
        where: eq(audiencesTable.accountId, id),
        orderBy: [asc(audiencesTable.createdAt)]
      }),
      // What each profile link's public posts showed.
      profileInsightViews(id),
      // The example posts new images follow.
      exampleViews(id)
    ])

  const allDone = Boolean(voiceConfig && knowledgeDoc && goal && preference)

  // The profile was changed by hand to another company: everything else
  // still belongs to the old one until a re-analysis switches it over.
  const setUpFor = account.contextIdentity
  // Meanwhile, what was learned from links that are not the new company's
  // is left out of every prompt (src/lib/profile-insights/in-use.ts).
  const heldBack = insights.filter(
    v => v.insights && !usesLearnedLink(v.profileUrl, account)
  )
  // A brand's saved links that name another account: a profile renamed to
  // another company before switches existed kept the old one's links. (A
  // person's handle often differs from their name, so only brands are told.)
  const otherLinks =
    !setUpFor && account.accountType === 'company'
      ? unrelatedLinks(profileLinksOf(account), account)
      : []

  return (
    <SetupShell account={account} hasSavedData>
      {setUpFor && (
        <section
          role="status"
          className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-300"
        >
          <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">
            <span className="font-semibold">
              Your profile now describes {account.name}, but your voice,
              knowledge, goals and ideas were set up for {setUpFor.name}.
            </span>{' '}
            Click Re-analyze in the AI Profile Assistant with {account.name}
            &apos;s details: the review then offers to switch everything over.
            {heldBack.length > 0 && (
              <>
                {' '}
                Until then, what was learned from{' '}
                {heldBack.map(v => v.profileUrl).join(', ')} is not used in
                ideas or posts.
              </>
            )}
          </p>
        </section>
      )}

      {otherLinks.length > 0 && (
        <section
          role="status"
          className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-300"
        >
          <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">
            <span className="font-semibold">
              {otherLinks.join(', ')} {otherLinks.length === 1 ? 'does' : 'do'}{' '}
              not look like {account.name}&apos;s.
            </span>{' '}
            If this identity was changed from another company, click Re-analyze
            in the AI Profile Assistant with {account.name}&apos;s details and
            switch it, so the old links, goals and knowledge are replaced. If
            the link is right, you can ignore this.
          </p>
        </section>
      )}

      {/* Setup Complete Banner */}
      {allDone && (
        <section className="border-border bg-surface relative mb-6 overflow-hidden rounded-xl border shadow-xs">
          <div aria-hidden className="bg-brand absolute inset-y-0 left-0 w-1" />
          <div className="flex flex-col gap-4 p-4 pl-5 sm:flex-row sm:items-center sm:justify-between sm:p-5 sm:pl-6">
            <div className="flex min-w-0 items-start gap-3.5">
              <div className="bg-brand/15 text-brand-strong flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-foreground text-sm leading-tight font-semibold sm:text-base">
                  Setup Complete — Ready to Generate!
                </h3>
                <p className="text-muted mt-1 text-xs">Fully configured:</p>
                {/* Each chip opens its step, so a tweak is one click away. */}
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {CONFIGURED_STEPS.map(step => (
                    <li key={step.key}>
                      <Link
                        href={`${IDENTITY_PATH}${step.path}`}
                        className="border-border text-foreground hover:bg-surface-hover inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
                      >
                        <Check className="text-brand-strong h-3.5 w-3.5" />
                        {step.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <Link
              href={`${IDENTITY_PATH}/runs`}
              className="bg-accent hover:bg-accent-hover text-background inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold whitespace-nowrap shadow-sm transition-colors"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>Generate Now</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      )}

      {/* Edit Content Identity & Core Identity */}
      {/* The form seeds its fields into local useState, which only runs on
              mount, so it remounts whenever the saved profile changes (for
              example AI suggestions applied in review). */}
      <EditIdentityForm
        key={`${account.id}:${account.updatedAt.getTime()}`}
        account={account}
        initialOfferings={offerings}
        initialAudiences={audiences}
        platforms={resolveChannels(preference).platforms}
        insights={insights}
        examples={examples}
      />
    </SetupShell>
  )
}
