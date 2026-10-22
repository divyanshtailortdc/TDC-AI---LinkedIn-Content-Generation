'use server'

import { db } from '@/db'
import {
  audiencesTable,
  goalsTable,
  knowledgeDocumentsTable,
  offeringsTable,
  preferencesTable,
  voiceConfigsTable
} from '@/db/schema'
import { resolvePreferences } from '@/lib/ai/context'
import {
  fieldLabel,
  IdentitySetupSuggestionsSchema,
  KnowledgeUrlsSchema,
  type SetupSection
} from '@/lib/ai/skills/profile-setup/schema'
import { profileFromRecords } from '@/lib/identity-profile'
import { findOwnedAccount } from '@/lib/ownership'
import { requireUser } from '@/lib/session'
import {
  buildGoalPayload,
  buildPreferencesPayload,
  buildVoiceSaveInput,
  mergeValues,
  planNewGoal,
  preferencesSuggestionValues,
  preferencesValuesFromRow,
  profileSuggestionValues,
  voiceSuggestionValues,
  voiceValuesFromConfig,
  type PreferencesValues,
  type ProfileValues,
  type VoiceValues
} from '@/lib/settings-merge'
import { AccountIdSchema } from '@/lib/setup-payloads'
import { normalizeUrlForCompare } from '@/lib/urls'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { updateAccountAction } from './actions'
import { createGoal } from '../goals/actions'
import { fetchUrlPreview, saveKnowledgeDocument } from './knowledge/actions'
import { savePreferences } from './preferences/actions'
import { saveVoiceConfigAction } from './voice/actions'

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
  /** The goal new runs use today; an AI goal is added paused beside it. */
  activeGoalTitle: string | null
  knowledgeUrls: string[]
}

export async function getIdentitySetupBaselineAction(
  accountId: string
): Promise<
  | { success: true; data: IdentitySetupBaseline }
  | { success: false; error: string }
> {
  const user = await requireUser()
  const id = AccountIdSchema.safeParse(accountId)
  if (!id.success)
    return { success: false, error: 'Invalid account identifier' }

  const account = await findOwnedAccount(db, user.id, id.data)
  if (!account) return { success: false, error: 'Identity not found' }

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
        .select({
          title: goalsTable.title,
          isActive: goalsTable.isActive,
          createdAt: goalsTable.createdAt
        })
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
      activeGoalTitle: planNewGoal(goals, '').activeGoalTitle,
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

/**
 * Knowledge pages added at once. Each is summarised by the AI, and many AI
 * calls at once have made the gateway time out; five is what this step has
 * always run together.
 */
const KNOWLEDGE_BATCH = 5

const ApplyInputSchema = z.object({
  accountId: AccountIdSchema,
  suggestions: IdentitySetupSuggestionsSchema,
  sections: z.object({
    profile: z.object({ mode: modeSchema }).optional(),
    voice: z.object({ mode: modeSchema }).optional(),
    preferences: z.object({ mode: modeSchema }).optional(),
    goals: z.boolean().optional(),
    knowledgeUrls: KnowledgeUrlsSchema.optional()
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
  const user = await requireUser()
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

  // Each section saves through the matching form action, which checks
  // ownership again; this check stops a foreign id before anything runs.
  const account = await findOwnedAccount(db, user.id, accountId)
  if (!account) return { success: false, error: 'Identity not found' }

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
            const existing = await db
              .select({
                title: goalsTable.title,
                isActive: goalsTable.isActive,
                createdAt: goalsTable.createdAt
              })
              .from(goalsTable)
              .where(eq(goalsTable.accountId, accountId))
            const plan = planNewGoal(existing, built.payload.title)
            if (plan.duplicate) {
              results.goals = {
                status: 'skipped',
                message: `A goal named "${plan.duplicate}" already exists, so no new goal was created.`
              }
            } else {
              await createGoal(accountId, built.payload, {
                active: plan.activate
              })
              results.goals = {
                status: 'applied',
                message: plan.activeGoalTitle
                  ? `Added the goal "${built.payload.title}" as paused, so your active goal "${plan.activeGoalTitle}" still steers new runs. Turn it on in Goals to switch.`
                  : `Created the goal "${built.payload.title}". New runs will use it.`
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
        // Keeps the review honest: only URLs the analysis listed are added.
        // The list arrives with the request, so this is not a security
        // boundary — anyone can add any public URL from the Knowledge step,
        // and every fetch still goes through the SSRF guard in safe-url.
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
        const addOne = async (requestedUrl: string) => {
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
        }
        for (let i = 0; i < requested.length; i += KNOWLEDGE_BATCH) {
          await Promise.all(requested.slice(i, i + KNOWLEDGE_BATCH).map(addOne))
        }

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
