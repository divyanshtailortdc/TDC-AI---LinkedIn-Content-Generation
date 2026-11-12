import { StepFields } from '@/components/account-setup/setup-frame'
import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import {
  preferencesTable,
  samplePostsTable,
  voiceConfigsTable
} from '@/db/schema'
import { resolvePreferences } from '@/lib/ai/context'
import { requireIdentity } from '@/lib/identity'
import { and, count, eq } from 'drizzle-orm'
import { PreferencesForm } from './preferences-form'

export default async function PreferencesPage() {
  const account = await requireIdentity()
  const [[existingPreferences], [voice], sampleCounts] = await Promise.all([
    db
      .select()
      .from(preferencesTable)
      .where(eq(preferencesTable.accountId, account.id)),
    db
      .select()
      .from(voiceConfigsTable)
      .where(eq(voiceConfigsTable.accountId, account.id)),
    // How many posts each platform's learned style came from.
    db
      .select({ platform: samplePostsTable.platform, posts: count() })
      .from(samplePostsTable)
      .where(
        and(
          eq(samplePostsTable.accountId, account.id),
          eq(samplePostsTable.isActive, true)
        )
      )
      .groupBy(samplePostsTable.platform)
  ])

  // The same resolution the pipeline uses, so the form shows what runs will see.
  const prefs = resolvePreferences(existingPreferences, voice)
  const postsOn = Object.fromEntries(sampleCounts.map(r => [r.platform, r.posts]))
  const learned = Object.fromEntries(
    Object.entries(prefs.channels.settings).flatMap(([platform, note]) =>
      note?.rubric
        ? [[platform, { rubric: note.rubric, count: postsOn[platform] ?? 0 }]]
        : []
    )
  )

  return (
    <SetupShell account={account} hasSavedData={Boolean(existingPreferences)}>
      {/* The automatic schedule moved to the Schedule page. */}
      <StepFields>
        <PreferencesForm
          accountId={account.id}
          hasSaved={Boolean(existingPreferences)}
          voiceEmoji={prefs.constraints.emoji_level}
          learned={learned}
          initial={{
            ideasPerRun: prefs.ideasPerRun,
            post_constraints: {
              cta_required: prefs.constraints.cta_required
            },
            guardrails: prefs.guardrails,
            channels: {
              enabledFormats: prefs.channels.enabledFormats,
              settings: prefs.channels.settings
            }
          }}
        />
      </StepFields>
    </SetupShell>
  )
}
