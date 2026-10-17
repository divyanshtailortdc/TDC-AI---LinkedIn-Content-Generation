'use server'

import { db } from '@/db'
import {
  accountsTable,
  audiencesTable,
  goalsTable,
  knowledgeDocumentsTable,
  offeringsTable,
  preferencesTable,
  voiceConfigsTable
} from '@/db/schema'
import { type IdentitySetupAnalysis } from '@/lib/ai/skills/profile-setup/schema'
import {
  buildGoalPayload,
  buildPreferencesPayload,
  buildVoiceSaveInput,
  mergeValues,
  preferencesSuggestionValues,
  preferencesValuesFromRow,
  profileSuggestionValues,
  voiceSuggestionValues,
  voiceValuesFromConfig,
  type PreferencesValues,
  type ProfileValues,
  type VoiceValues
} from '@/lib/settings-merge'
import {
  fieldLabel,
  IdentitySetupSuggestionsSchema,
  type SetupSection
} from '@/lib/ai/skills/profile-setup/schema'
import { normalizeUrlForCompare } from '@/lib/urls'
import { resolvePreferences } from '@/lib/ai/context'
import { profileFromRecords } from '@/lib/identity-profile'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createGoal } from './[id]/goals/actions'
import {
  fetchUrlPreview,
  saveKnowledgeDocument
} from './[id]/knowledge/actions'
import { savePreferences } from './[id]/preferences/actions'
import { saveVoiceConfigAction } from './[id]/voice/actions'
import { updateAccountAction } from './actions'

async function findAccount(accountId: string) {
  return db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, accountId)
  })
}

async function loadPrimaryRows(accountId: string) {
  const [[offering], [audience]] = await Promise.all([
    db
      .select()
      .from(offeringsTable)
      .where(eq(offeringsTable.accountId, accountId))
      .orderBy(asc(offeringsTable.createdAt))
      .limit(1),
    db
      .select()
      .from(audiencesTable)
      .where(eq(audiencesTable.accountId, accountId))
      .orderBy(asc(audiencesTable.createdAt))
      .limit(1)
  ])
  return { offering, audience }
}

// ---------------------------------------------------------------------------
// Baseline: what is saved now, so the review can show what would be kept.
// ---------------------------------------------------------------------------

export type IdentitySetupBaseline = {
  profile: ProfileValues
  voice: VoiceValues
  hasVoice: boolean
  preferences: PreferencesValues
  hasPreferences: boolean
  goalTitles: string[]
  knowledgeUrls: string[]
}

export async function getIdentitySetupBaselineAction(
  accountId: string
): Promise<
  | { success: true; data: IdentitySetupBaseline }
  | { success: false; error: string }
> {
  const id = z.string().uuid().safeParse(accountId)
  if (!id.success)
    return { success: false, error: 'Invalid account identifier' }

  const account = await findAccount(id.data)
  if (!account) return { success: false, error: 'Account identity not found' }

  const [{ offering, audience }, voiceConfig, preferences, goals, docs] =
    await Promise.all([
      loadPrimaryRows(id.data),
      db.query.voiceConfigsTable.findFirst({
        where: eq(voiceConfigsTable.accountId, id.data)
      }),
      db.query.preferencesTable.findFirst({
        where: eq(preferencesTable.accountId, id.data)
      }),
      db
        .select({ title: goalsTable.title })
        .from(goalsTable)
        .where(eq(goalsTable.accountId, id.data)),
      db
        .select({ sourceUrl: knowledgeDocumentsTable.sourceUrl })
        .from(knowledgeDocumentsTable)
        .where(eq(knowledgeDocumentsTable.accountId, id.data))
    ])

  return {
    success: true,
    data: {
      profile: profileFromRecords(account, offering, audience),
      voice: voiceValuesFromConfig(voiceConfig),
      hasVoice: Boolean(voiceConfig),
      preferences: preferencesValuesFromRow(preferences),
      hasPreferences: Boolean(preferences),
      goalTitles: goals.map(g => g.title),
      knowledgeUrls: docs
        .map(d => d.sourceUrl)
        .filter((u): u is string => Boolean(u))
    }
  }
}

// ---------------------------------------------------------------------------
// Apply: writes only the sections the user confirmed, through the same save
// actions the forms use, so their validation applies here too.
// ---------------------------------------------------------------------------

const modeSchema = z.enum(['fill-empty', 'replace'])

const ApplyInputSchema = z.object({
  accountId: z.string().uuid('Invalid account identifier'),
  suggestions: IdentitySetupSuggestionsSchema,
  sections: z.object({
    profile: z.object({ mode: modeSchema }).optional(),
    voice: z.object({ mode: modeSchema }).optional(),
    preferences: z.object({ mode: modeSchema }).optional(),
    goals: z.boolean().optional(),
    knowledgeUrls: z.array(z.string().max(500)).max(5).optional()
  })
})

export type ApplyIdentitySetupInput = z.input<typeof ApplyInputSchema>

export type SectionApplyResult = {
  /** partial: knowledge only, some URLs were added and some were not. */
  status: 'applied' | 'partial' | 'skipped' | 'failed'
  message: string
  filled?: string[]
  kept?: string[]
  /**
   * Knowledge only: the requested URLs that are now in the knowledge base,
   * added now or already there, as they were sent. The rest can be retried.
   */
  savedUrls?: string[]
}

export type ApplyIdentitySetupResult =
  | {
      success: true
      results: Partial<Record<SetupSection, SectionApplyResult>>
    }
  | { success: false; error: string }

function labels(
  section: SetupSection,
  fields: string[],
  accountType?: 'personal' | 'company'
) {
  return fields.map(f => fieldLabel(section, f, accountType))
}

function describeMerge(
  section: SetupSection,
  filled: string[],
  kept: string[],
  accountType?: 'personal' | 'company'
): string {
  const parts: string[] = []
  if (filled.length > 0)
    parts.push(`Updated ${labels(section, filled, accountType).join(', ')}.`)
  if (kept.length > 0)
    parts.push(
      `Kept your saved ${labels(section, kept, accountType).join(', ')}.`
    )
  return parts.join(' ') || 'Nothing to change.'
}

export async function applyIdentitySetupAction(
  input: ApplyIdentitySetupInput
): Promise<ApplyIdentitySetupResult> {
  const parsed = ApplyInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: `The suggestions could not be validated: ${parsed.error.issues
        .slice(0, 3)
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    }
  }
  const { accountId, suggestions, sections } = parsed.data

  const account = await findAccount(accountId)
  if (!account) return { success: false, error: 'Account identity not found' }

  const results: Partial<Record<SetupSection, SectionApplyResult>> = {}
  // Sections write to separate tables, so they run side by side; each one
  // records its own outcome and a failure in one does not stop the others.
  const tasks: Promise<void>[] = []

  if (sections.profile) {
    const profileMode = sections.profile.mode
    const accountType =
      account.accountType === 'company' ? 'company' : 'personal'
    tasks.push(
      (async () => {
        try {
          const { offering, audience } = await loadPrimaryRows(accountId)
          const current = profileFromRecords(account, offering, audience)
          const merged = mergeValues(
            current,
            profileSuggestionValues(suggestions.profile),
            profileMode
          )
          if (merged.filled.length === 0) {
            results.profile = {
              status: 'skipped',
              message: describeMerge('profile', [], merged.kept, accountType),
              kept: merged.kept
            }
          } else {
            const res = await updateAccountAction({
              id: accountId,
              ...merged.values
            })
            results.profile = res.success
              ? {
                  status: 'applied',
                  message: describeMerge(
                    'profile',
                    merged.filled,
                    merged.kept,
                    accountType
                  ),
                  filled: merged.filled,
                  kept: merged.kept
                }
              : {
                  status: 'failed',
                  message: res.error || 'Profile could not be saved.'
                }
          }
        } catch (error: any) {
          results.profile = {
            status: 'failed',
            message: error?.message || 'Profile could not be saved.'
          }
        }
      })()
    )
  }

  if (sections.voice) {
    const voiceMode = sections.voice.mode
    tasks.push(
      (async () => {
        try {
          const existing = await db.query.voiceConfigsTable.findFirst({
            where: eq(voiceConfigsTable.accountId, accountId)
          })
          const merged = mergeValues(
            voiceValuesFromConfig(existing),
            voiceSuggestionValues(suggestions.voice),
            voiceMode
          )
          if (merged.filled.length === 0) {
            results.voice = {
              status: 'skipped',
              message: describeMerge('voice', [], merged.kept),
              kept: merged.kept
            }
          } else {
            const res = await saveVoiceConfigAction(
              buildVoiceSaveInput(accountId, merged.values)
            )
            results.voice = res.success
              ? {
                  status: 'applied',
                  message: describeMerge('voice', merged.filled, merged.kept),
                  filled: merged.filled,
                  kept: merged.kept
                }
              : {
                  status: 'failed',
                  message: res.error || 'Voice could not be saved.'
                }
          }
        } catch (error: any) {
          results.voice = {
            status: 'failed',
            message: error?.message || 'Voice could not be saved.'
          }
        }
      })()
    )
  }

  if (sections.goals) {
    tasks.push(
      (async () => {
        try {
          const built = buildGoalPayload(suggestions.goals)
          if ('missing' in built) {
            results.goals = {
              status: 'skipped',
              message: `The goal still needs: ${labels('goals', built.missing).join(', ')}.`
            }
          } else {
            const duplicate = await db.query.goalsTable.findFirst({
              where: and(
                eq(goalsTable.accountId, accountId),
                eq(goalsTable.title, built.payload.title.trim())
              )
            })
            if (duplicate) {
              results.goals = {
                status: 'skipped',
                message: `A goal named "${duplicate.title}" already exists, so no new goal was created.`
              }
            } else {
              await createGoal(accountId, built.payload)
              results.goals = {
                status: 'applied',
                message: `Created the goal "${built.payload.title}". Your existing goals were not changed.`
              }
            }
          }
        } catch (error: any) {
          results.goals = {
            status: 'failed',
            message: error?.message || 'Goal could not be created.'
          }
        }
      })()
    )
  }

  if (sections.preferences) {
    const preferencesMode = sections.preferences.mode
    tasks.push(
      (async () => {
        try {
          const row = await db.query.preferencesTable.findFirst({
            where: eq(preferencesTable.accountId, accountId)
          })
          const merged = mergeValues(
            preferencesValuesFromRow(row),
            preferencesSuggestionValues(suggestions.preferences),
            preferencesMode
          )
          if (merged.filled.length === 0) {
            results.preferences = {
              status: 'skipped',
              message: describeMerge('preferences', [], merged.kept),
              kept: merged.kept
            }
          } else {
            // Ideas per run and the CTA setting keep what runs use today.
            const current = resolvePreferences(row)
            await savePreferences(
              accountId,
              buildPreferencesPayload(
                {
                  pillars: current.pillars,
                  ideasPerRun: current.ideasPerRun,
                  post_constraints: {
                    cta_required: current.constraints.cta_required
                  },
                  guardrails: current.guardrails
                },
                merged.values
              )
            )
            results.preferences = {
              status: 'applied',
              message: `${describeMerge('preferences', merged.filled, merged.kept)} Schedule settings were not changed.`,
              filled: merged.filled,
              kept: merged.kept
            }
          }
        } catch (error: any) {
          results.preferences = {
            status: 'failed',
            message: error?.message || 'Preferences could not be saved.'
          }
        }
      })()
    )
  }

  if (sections.knowledgeUrls?.length) {
    tasks.push(
      (async () => {
        // Only sources from this analysis can be ingested, never arbitrary URLs.
        const offered = new Map(
          suggestions.knowledge.sources
            .filter(s => s.url)
            .map(s => [normalizeUrlForCompare(s.url!), s.url!])
        )
        const existingDocs = await db
          .select({ sourceUrl: knowledgeDocumentsTable.sourceUrl })
          .from(knowledgeDocumentsTable)
          .where(eq(knowledgeDocumentsTable.accountId, accountId))
        const saved = new Set(
          existingDocs
            .map(d => d.sourceUrl)
            .filter((u): u is string => Boolean(u))
            .map(normalizeUrlForCompare)
        )

        const added: string[] = []
        const problems: string[] = []
        const savedUrls: string[] = []
        const requested = [...new Set(sections.knowledgeUrls)]
        await Promise.all(
          requested.map(async requestedUrl => {
            const key = normalizeUrlForCompare(requestedUrl)
            const url = offered.get(key)
            if (!url) {
              problems.push(
                `${requestedUrl} was not one of the suggested sources`
              )
              return
            }
            if (saved.has(key)) {
              problems.push(`${url} is already in your knowledge base`)
              savedUrls.push(requestedUrl)
              return
            }
            saved.add(key)
            // Usually served from the scraper's cache: analysis just read it.
            const preview = await fetchUrlPreview(url)
            if (!preview.success || !preview.title || !preview.content) {
              problems.push(
                `${url}: ${preview.error || 'could not be fetched'}`
              )
              return
            }
            try {
              await saveKnowledgeDocument({
                accountId,
                title: preview.title,
                sourceType: 'url',
                sourceUrl: url,
                content: preview.content
              })
              added.push(preview.title)
              savedUrls.push(requestedUrl)
            } catch (error: any) {
              problems.push(`${url}: ${error?.message || 'could not be saved'}`)
            }
          })
        )

        results.knowledge = {
          status:
            added.length > 0
              ? problems.length > 0
                ? 'partial'
                : 'applied'
              : problems.length > 0
                ? 'failed'
                : 'skipped',
          savedUrls,
          message: [
            added.length > 0
              ? `Added ${added.map(t => `"${t}"`).join(', ')}.`
              : '',
            problems.length > 0 ? `Not added: ${problems.join('; ')}.` : ''
          ]
            .filter(Boolean)
            .join(' ')
        }
      })()
    )
  }

  await Promise.all(tasks)
  return { success: true, results }
}
