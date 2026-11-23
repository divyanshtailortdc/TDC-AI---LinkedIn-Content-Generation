'use client'

import {
  switchIdentityAction,
  type IdentitySetupBaseline,
  type SectionApplyResult
} from '@/app/(app)/identity/ai-setup-actions'
import { showToast } from '@/components/toast-notification'
import {
  EMPTY_SUGGESTIONS,
  getSectionStatus,
  officialSiteOf,
  type IdentitySetupSuggestions
} from '@/lib/ai/skills/profile-setup/schema'
import { PLATFORMS, type PlatformId } from '@/lib/formats'
import {
  comparableName,
  linkFitsIdentity,
  removedProfileLinks,
  sameSite,
  siteOf,
  switchProfileLinks
} from '@/lib/identity-change'
import type { SwitchSummary } from '@/lib/identity-switch'
import { canonicalProfileLink, type ProfileLinks } from '@/lib/profile-links'
import { isEmptyValue } from '@/lib/settings-merge'
import { normalizeUrlForCompare } from '@/lib/urls'
import { AlertCircle, ArrowRightLeft, CheckCircle2, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { writeSwitchLeftovers, type IdentitySetupDraft } from './draft-store'
import {
  itemOf,
  ReviewActions,
  ReviewShell,
  SectionCard,
  SuggestionRow,
  validateField,
  type Item
} from './review-dialog'

/** The Profile fields a switch writes; the links have their own section. */
const PROFILE_FIELDS = [
  'name',
  'company',
  'description',
  'targetAudience',
  'offerings',
  'industry',
  'websiteUrl'
] as const
const REQUIRED = new Set(['name', 'description', 'targetAudience', 'industry'])
const VOICE_FIELDS = [
  'tone',
  'derivedStyleRubric',
  'formality',
  'directness',
  'perspective',
  'emojiPolicy',
  'hashtagPolicy',
  'bannedWords'
] as const
const PREFERENCE_FIELDS = ['bannedTopics', 'complianceNotes'] as const

type Section = 'profile' | 'voice' | 'goals' | 'preferences'

const EMPTY_ITEM: Item = { value: '', kind: 'recommendation', source: 'edited' }

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`

/** The fields of a section that hold a value, as the server reads them. */
function filled<T extends Record<string, unknown>>(section: T): T {
  return Object.fromEntries(
    Object.entries(section).filter(
      ([key, item]) =>
        key === 'missing' ||
        (item && typeof item === 'object' && !isEmptyValue((item as Item).value))
    )
  ) as T
}

/**
 * Reviewing an analysis of another company as a switch: the identity becomes
 * that company. Every value below replaces the old one, a value left empty
 * clears it, and the old company's data is listed with what happens to it,
 * before anything is saved (src/lib/identity-switch.ts does the switch).
 */
export function SwitchIdentityReview({
  accountId,
  draft,
  baseline,
  onBack,
  onClose
}: {
  accountId: string
  draft: IdentitySetupDraft
  baseline: IdentitySetupBaseline
  /** Back to reviewing the suggestions as updates to the same company. */
  onBack: () => void
  onClose: () => void
}) {
  const router = useRouter()
  const analyzed = draft.analyzed ?? draft.suggestions
  const preview = baseline.switchPreview
  const [edited, setEdited] = useState<IdentitySetupSuggestions>(analyzed)
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState<Set<string>>(
    () =>
      new Set(
        [...REQUIRED]
          .filter(field => isEmptyValue(itemOrEmpty(analyzed, 'profile', field).value))
          .map(field => `profile.${field}`)
      )
  )
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [done, setDone] = useState<{
    summary: SwitchSummary
    knowledge?: SectionApplyResult
  } | null>(null)

  const newName =
    String(edited.profile.name?.value ?? '').trim() || 'the new company'
  // A profile renamed before switches existed already carries the new name,
  // with the old company's links, goals and knowledge still around it.
  const sameName =
    comparableName(baseline.setUpFor.name) === comparableName(newName)
  const oldName = sameName ? 'the earlier setup' : baseline.setUpFor.name || 'your identity'
  const oldNames = sameName ? "the earlier setup's" : `${oldName}'s`
  const officialUrl = officialSiteOf(analyzed)

  // Links: each platform's best candidate for the new company, from what
  // was typed, suggested or found, then what is saved. A saved link whose
  // account shares nothing with the new company is most likely the old
  // one's (instagram.com/zomato on TDCCommerce), so it starts unticked.
  const described = {
    name: newName,
    company: String(edited.profile.company?.value ?? ''),
    websiteUrl: String(edited.profile.websiteUrl?.value ?? '')
  }
  const typed = draft.input?.linkedinUrl?.trim() || ''
  const proposal = switchProfileLinks({
    typed,
    suggested: String(analyzed.profile.linkedinUrl?.value ?? '') || null,
    found: draft.profileLinks,
    saved: baseline.profileLinks,
    platforms: baseline.platforms
  })
  const savedUrls = new Set(
    Object.values(baseline.profileLinks).map(url => normalizeUrlForCompare(url!))
  )
  const doubtful = (url: string) =>
    savedUrls.has(normalizeUrlForCompare(url)) && !linkFitsIdentity(url, described)
  const [linkChoice, setLinkChoice] = useState<Partial<Record<PlatformId, boolean>>>({})
  const proposed = Object.entries(proposal.links) as Array<[PlatformId, string]>
  const keptLinks: ProfileLinks = Object.fromEntries(
    proposed.filter(([p, url]) => linkChoice[p] ?? !doubtful(url))
  )
  const removedLinks = removedProfileLinks(baseline.profileLinks, keptLinks)
  // Saved links another link replaces; an unticked one shows as its own row.
  const replacedLinks = removedLinks.filter(
    url => !proposed.some(([, candidate]) => candidate === url)
  )
  // What was learned from a profile that stays is kept (see keepsInsight).
  const clearedInsights = preview.insights.filter(({ platform, profileUrl }) => {
    const link = keptLinks[platform]
    return !link || (canonicalProfileLink(platform, link) ?? link.trim()) !== profileUrl
  })

  // How each platform the identity posts on sounds, from the analysis.
  const channels = Object.fromEntries(
    baseline.platforms.map(p => [
      p,
      { style: draft.styles?.[p], ...(draft.channelNotes?.[p] ?? {}) }
    ])
  )
  const hasChannelNotes = baseline.platforms.some(
    p => draft.styles?.[p] || draft.channelNotes?.[p]
  )

  const goalReady = getSectionStatus(analyzed, 'goals').state === 'ready'
  const [includeGoal, setIncludeGoal] = useState(goalReady)

  // Knowledge: the new company's pages in, the old documents out. A
  // document on the new company's own site is kept.
  // So is a page the analysis suggests again.
  const newSite = siteOf(String(edited.profile.websiteUrl?.value ?? ''))
  const suggestedPages = new Set(
    analyzed.knowledge.sources
      .filter(source => source.url)
      .map(source => normalizeUrlForCompare(source.url!))
  )
  const [removeDocs, setRemoveDocs] = useState<Set<string>>(
    () =>
      new Set(
        preview.knowledgeDocs
          .filter(
            doc =>
              !doc.sourceUrl ||
              !(
                sameSite(siteOf(doc.sourceUrl), newSite) ||
                suggestedPages.has(normalizeUrlForCompare(doc.sourceUrl))
              )
          )
          .map(doc => doc.id)
      )
  )
  const keptDocUrls = new Set(
    preview.knowledgeDocs
      .filter(doc => doc.sourceUrl && !removeDocs.has(doc.id))
      .map(doc => normalizeUrlForCompare(doc.sourceUrl!))
  )
  const sources = analyzed.knowledge.sources.filter(
    s => s.url && !keptDocUrls.has(normalizeUrlForCompare(s.url))
  )
  const [addUrls, setAddUrls] = useState<Set<string>>(
    () => new Set(sources.filter(s => s.accessible).map(s => s.url!))
  )
  const [resetBrand, setResetBrand] = useState(Boolean(preview.brandTheme))

  const commit = (section: Section, field: string, value: unknown) => {
    const key = `${section}.${field}`
    const required = section === 'profile' && REQUIRED.has(field)
    const problem = isEmptyValue(value)
      ? required
        ? 'Required: enter a value.'
        : null
      : validateField(section, field, value)
    setInvalid(prev => {
      const next = new Set(prev)
      if (problem) next.add(key)
      else next.delete(key)
      return next
    })
    if (problem) return problem
    setEdited(prev => {
      const sectionData = { ...prev[section] } as Record<string, unknown>
      if (isEmptyValue(value)) delete sectionData[field]
      else sectionData[field] = { value, kind: 'fact', source: 'edited', confidence: 'high' }
      return { ...prev, [section]: sectionData }
    })
    return null
  }

  const blockingInvalid = [...invalid].some(
    key => !key.startsWith('goals.') || includeGoal
  )

  const apply = async () => {
    setApplying(true)
    setApplyError(null)
    try {
      const res = await switchIdentityAction({
        accountId,
        suggestions: {
          ...EMPTY_SUGGESTIONS,
          profile: filled(edited.profile),
          voice: filled(edited.voice),
          preferences: filled(edited.preferences),
          goals: includeGoal ? filled(edited.goals) : EMPTY_SUGGESTIONS.goals,
          // The server adds only pages that were among these.
          knowledge: analyzed.knowledge
        },
        profileLinks: keptLinks,
        otherLink: proposal.otherLink ?? undefined,
        channels,
        includeGoal,
        removeKnowledgeIds: [...removeDocs],
        resetBrandTheme: resetBrand,
        knowledgeUrls: addUrls.size > 0 ? [...addUrls] : undefined
      })
      if (!res.success) {
        setApplyError(res.error)
        return
      }
      // Pages that could not be added stay, to be added again; the rest of
      // the analysis is now saved.
      const saved = new Set(res.knowledge?.savedUrls ?? [])
      const unsaved = analyzed.knowledge.sources.filter(
        s => s.url && addUrls.has(s.url) && !saved.has(s.url)
      )
      // An empty draft is cleared by the card once this window closes.
      writeSwitchLeftovers(accountId, unsaved)
      router.refresh()
      setDone(res)
      showToast({
        type: 'success',
        title: `Switched to ${newName}`,
        message: 'No run was started.'
      })
    } catch {
      setApplyError('Could not reach the server. Nothing was changed. Please try again.')
    } finally {
      setApplying(false)
    }
  }

  if (done) {
    return (
      <ReviewShell
        title={`Switched to ${newName}`}
        description="What changed, and what was kept."
        onClose={onClose}
        footer={
          <>
            <span />
            <button
              type="button"
              onClick={onClose}
              className="bg-accent hover:bg-accent-hover text-background h-8 rounded-lg px-3.5 text-[13px] font-semibold shadow-sm transition-colors"
            >
              Done
            </button>
          </>
        }
      >
        <SwitchResults
          summary={done.summary}
          knowledge={done.knowledge}
          oldName={oldName}
          posts={preview.posts}
          followedNewsletters={preview.followedNewsletters}
        />
      </ReviewShell>
    )
  }

  const profileRow = (field: string) => {
    const item = itemOrEmpty(edited, 'profile', field)
    const saved = baseline.profile[field as keyof typeof baseline.profile]
    const missing = isEmptyValue(item.value)
    return (
      <SuggestionRow
        key={`${draft.id}-profile.${field}`}
        section="profile"
        field={field}
        accountType={draft.accountType}
        item={missing ? { ...item, note: noteForEmpty(field) } : item}
        officialUrl={officialUrl}
        current={isEmptyValue(saved) ? undefined : saved}
        checked
        selectable={false}
        // An empty required field is asked for straight away.
        editing={editing || (missing && REQUIRED.has(field))}
        disabled={applying}
        onToggle={() => {}}
        onCommit={value => commit('profile', field, value)}
      />
    )
  }

  const suggestedRows = (section: 'voice' | 'preferences', fields: readonly string[]) =>
    fields
      .filter(field => (edited[section] as Record<string, unknown>)[field])
      .map(field => (
        <SuggestionRow
          key={`${draft.id}-${section}.${field}`}
          section={section}
          field={field}
          item={itemOf(edited, section, field)}
          current={undefined}
          checked
          selectable={false}
          editing={editing}
          disabled={applying}
          onToggle={() => {}}
          onCommit={value => commit(section, field, value)}
        />
      ))

  const voiceRows = suggestedRows('voice', VOICE_FIELDS)
  const preferenceRows = suggestedRows('preferences', PREFERENCE_FIELDS)

  return (
    <ReviewShell
      title={sameName ? `Switch everything to ${newName}` : `Switch ${oldName} to ${newName}`}
      description={`Everything below replaces ${sameName ? 'the earlier setup' : `what was set up for ${oldName}`}. Posts already made are kept.`}
      busy={applying}
      onClose={onClose}
      footer={
        <ReviewActions
          status={
            preview.blocked
              ? preview.blocked
              : blockingInvalid
                ? 'Fill in the highlighted values first.'
                : 'Nothing changes until you switch.'
          }
          editing={editing}
          editDisabled={false}
          onToggleEdit={() => setEditing(!editing)}
          onCancel={onClose}
          onApply={apply}
          applyDisabled={Boolean(preview.blocked) || blockingInvalid}
          applying={applying}
          applyLabel={`Switch to ${newName}`}
        />
      }
    >
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
        <ArrowRightLeft className="mt-px h-3.5 w-3.5 shrink-0" />
        <div className="space-y-1">
          <p>
            {baseline.changedByHand
              ? `Your profile now describes ${newName}, but your voice, knowledge, goals and ideas were set up for ${oldName}.`
              : sameName
                ? `Your profile already says ${newName}, but some of its links, goals, knowledge or ideas look like another company's.`
                : `This analysis describes ${newName}, not ${oldName}.`}{' '}
            Switching makes this identity {newName} everywhere. Nothing is
            saved until you click Switch.
          </p>
          <button
            type="button"
            onClick={onBack}
            disabled={applying}
            className="font-semibold underline-offset-2 hover:underline"
          >
            Same company? Review as updates instead
          </button>
        </div>
      </div>

      {preview.blocked && (
        <Notice tone="error">{preview.blocked}</Notice>
      )}

      <SectionCard
        title="Profile"
        note={`Replaces ${oldNames} profile. A field left empty is cleared.`}
      >
        {PROFILE_FIELDS.map(profileRow)}
      </SectionCard>

      <SectionCard
        title="Profile links"
        note={
          proposed.length > 0
            ? `Only ticked links are kept. A saved link that does not look like ${newName}'s starts unticked.`
            : `No link was given for ${newName}, so the profile keeps none.`
        }
      >
        {proposed.map(([platform, url]) => {
          const kept = Boolean(keptLinks[platform])
          const source = proposal.sources[platform]
          return (
            <Row
              key={platform}
              id={`switch-link-${platform}`}
              checked={kept}
              disabled={applying}
              onChange={checked =>
                setLinkChoice(prev => ({ ...prev, [platform]: checked }))
              }
              title={`${PLATFORMS[platform].label}${kept ? '' : ': removed'}`}
              detail={[
                url,
                source === 'typed'
                  ? 'you gave this'
                  : source === 'saved'
                    ? 'saved on the profile'
                    : `found for ${newName}`,
                doubtful(url) && `does not look like ${newName}'s`
              ]
                .filter(Boolean)
                .join(' · ')}
              tone={kept ? undefined : 'remove'}
            />
          )
        })}
        {replacedLinks.map(url => (
          <Row key={url} title="Replaced" detail={url} tone="remove" />
        ))}
      </SectionCard>

      <SectionCard
        title="Voice"
        note={`Settings not listed go back to their defaults. The style learned from ${oldNames} posts is cleared${preview.samplePosts > 0 ? `, and its ${plural(preview.samplePosts, 'sample post')} switched off` : ''}.`}
      >
        {voiceRows.length > 0 ? voiceRows : null}
      </SectionCard>

      <SectionCard
        title="Platforms"
        note={
          hasChannelNotes
            ? 'How each platform sounds. Where you post does not change.'
            : 'The analysis said nothing per platform, so each goes back to its default style. Where you post does not change.'
        }
      >
        {hasChannelNotes
          ? baseline.platforms.map(p => {
              const note = channels[p]!
              return (
                <Row
                  key={p}
                  title={PLATFORMS[p].label}
                  detail={[
                    note.style && `Style: ${note.style}`,
                    'audience' in note && note.audience && `For: ${note.audience}`,
                    'tone' in note && note.tone && `Tone: ${note.tone}`
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Default style'}
                />
              )
            })
          : null}
      </SectionCard>

      <SectionCard
        title="Goal"
        note={
          preview.activeGoals.length > 0
            ? `The active ${preview.activeGoals.length === 1 ? 'goal' : 'goals'} (${preview.activeGoals.map(g => `"${g}"`).join(', ')}) will be paused and kept.`
            : undefined
        }
        selectAll={
          goalReady
            ? {
                checked: includeGoal ? 1 : 0,
                total: 1,
                disabled: applying,
                label: 'Make this the active goal',
                onChange: setIncludeGoal
              }
            : undefined
        }
      >
        {goalReady ? (
          Object.keys(edited.goals)
            .filter(field => field !== 'missing' && (edited.goals as Record<string, unknown>)[field])
            .map(field => (
              <SuggestionRow
                key={`${draft.id}-goals.${field}`}
                section="goals"
                field={field}
                item={itemOf(edited, 'goals', field)}
                current={undefined}
                checked={includeGoal}
                selectable={false}
                editing={editing}
                disabled={applying}
                onToggle={() => {}}
                onCommit={value => commit('goals', field, value)}
              />
            ))
        ) : (
          <Row
            title="No goal yet"
            detail="The analysis could not suggest a complete goal. Add one in Goals before your next run."
          />
        )}
      </SectionCard>

      <SectionCard
        title="Topics to avoid and extra rules"
        note="Anything not listed here is cleared."
      >
        {preferenceRows.length > 0 ? preferenceRows : null}
      </SectionCard>

      <SectionCard
        title="Knowledge"
        note={`Adds ${newName}'s pages and removes the documents you tick. Removed documents leave your knowledge base.`}
      >
        {sources.map(source => (
          <Row
            key={source.url}
            id={`switch-add-${source.url}`}
            checked={addUrls.has(source.url!)}
            disabled={applying}
            onChange={checked =>
              setAddUrls(prev => {
                const next = new Set(prev)
                if (checked) next.add(source.url!)
                else next.delete(source.url!)
                return next
              })
            }
            title={`Add: ${source.title}`}
            detail={`${source.official ? 'Official site · ' : ''}${source.url}${source.accessible ? '' : ' · read when added'}`}
          />
        ))}
        {preview.knowledgeDocs.map(doc => (
          <Row
            key={doc.id}
            id={`switch-remove-${doc.id}`}
            checked={removeDocs.has(doc.id)}
            disabled={applying}
            onChange={checked =>
              setRemoveDocs(prev => {
                const next = new Set(prev)
                if (checked) next.add(doc.id)
                else next.delete(doc.id)
                return next
              })
            }
            title={`Remove: ${doc.title}`}
            detail={doc.sourceUrl ?? (doc.sourceType === 'url' ? 'Web page' : 'Added by you')}
            tone="remove"
          />
        ))}
        {sources.length === 0 && preview.knowledgeDocs.length === 0 && (
          <Row title="Nothing to change" detail="Add documents on the Knowledge step." />
        )}
      </SectionCard>

      <SectionCard title={`What else happens to ${oldNames} data`}>
        {preview.openIdeas > 0 && (
          <Row
            title={`${plural(preview.openIdeas, 'open idea')} rejected`}
            detail="Kept under Rejected, so none is turned into a post for the new company."
          />
        )}
        {clearedInsights.length > 0 && (
          <Row
            title="Profile insights cleared"
            detail={`What was learned from ${clearedInsights
              .map(i => i.profileUrl)
              .join(', ')}. The new links are read after the switch.`}
          />
        )}
        {preview.untouchedNewsletters > 0 && (
          <Row
            title={`${plural(preview.untouchedNewsletters, 'newsletter suggestion')} removed`}
            detail={`Found for ${oldName}; you had not acted on them.`}
          />
        )}
        {(preview.extraOfferings > 0 || preview.extraAudiences > 0) && (
          <Row
            title="Older offerings and audiences retired"
            detail={[
              preview.extraOfferings > 0 && `${plural(preview.extraOfferings, 'offering')} switched off`,
              preview.extraAudiences > 0 && `${plural(preview.extraAudiences, 'audience')} removed`
            ]
              .filter(Boolean)
              .join(', ')}
          />
        )}
        <Row
          title="Prompts forget the old history"
          detail={`New ideas and posts are no longer steered by ${oldNames} past posts, ideas or rejections. Scheduled days serve the new goal.`}
        />
        {preview.connections.length > 0 && (
          <Row
            title="Connected accounts stay connected"
            detail={`${preview.connections
              .map(c => `${PLATFORMS[c.platform].label}${c.name ? ` (${c.name})` : ''}`)
              .join(', ')}. Auto-publish is turned off on them until you check they are ${newName}'s.`}
          />
        )}
        {preview.brandTheme && (
          <Row
            id="switch-brand"
            checked={resetBrand}
            disabled={applying}
            onChange={setResetBrand}
            title="Reset the brand theme"
            detail={[
              preview.brandTheme.logo && 'logo',
              preview.brandTheme.colors && 'colours',
              preview.brandTheme.footerText && `footer "${preview.brandTheme.footerText}"`
            ]
              .filter(Boolean)
              .join(', ')}
            tone="remove"
          />
        )}
        <Row
          title="Kept as they are"
          detail={[
            preview.posts > 0 && plural(preview.posts, 'post'),
            'published history and past runs',
            preview.followedNewsletters > 0 &&
              `${plural(preview.followedNewsletters, 'newsletter')} you saved or signed up to (check they fit ${newName})`
          ]
            .filter(Boolean)
            .join(', ')}
        />
      </SectionCard>

      {applyError && <Notice tone="error">{applyError}</Notice>}
    </ReviewShell>
  )
}

/** A field's item, or an empty one when the analysis gave it no value. */
function itemOrEmpty(
  suggestions: IdentitySetupSuggestions,
  section: Section,
  field: string
): Item {
  return (
    ((suggestions[section] as unknown as Record<string, Item | undefined>)[field] as Item) ??
    EMPTY_ITEM
  )
}

function noteForEmpty(field: string) {
  return REQUIRED.has(field)
    ? 'The analysis did not find this. Enter it to switch.'
    : 'Not found by the analysis, so it is cleared.'
}

/** One line of a section: a checkbox when it can be changed. */
function Row({
  id,
  title,
  detail,
  checked,
  disabled,
  onChange,
  tone
}: {
  id?: string
  title: string
  detail?: string
  checked?: boolean
  disabled?: boolean
  onChange?: (checked: boolean) => void
  tone?: 'remove'
}) {
  const selectable = onChange !== undefined
  return (
    <li
      className={`flex gap-3 px-4 py-3 transition-colors ${
        selectable && checked ? 'bg-brand/5 shadow-[inset_2px_0_0_var(--color-brand)]' : ''
      }`}
    >
      {selectable ? (
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
          className="accent-brand mt-0.5 h-4 w-4 shrink-0"
        />
      ) : (
        <span aria-hidden className="w-4 shrink-0" />
      )}
      <label htmlFor={selectable ? id : undefined} className="min-w-0 flex-1">
        <span
          className={`block text-sm font-medium ${
            tone === 'remove' ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'
          }`}
        >
          {title}
        </span>
        {detail && (
          <span className="text-muted block text-xs wrap-break-word">{detail}</span>
        )}
      </label>
    </li>
  )
}

function Notice({ tone, children }: { tone: 'error'; children: ReactNode }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
        tone === 'error'
          ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
          : ''
      }`}
    >
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  )
}

/** After the switch: what changed, what was kept, and what to check. */
function SwitchResults({
  summary,
  knowledge,
  oldName,
  posts,
  followedNewsletters
}: {
  summary: SwitchSummary
  knowledge?: SectionApplyResult
  oldName: string
  posts: number
  followedNewsletters: number
}) {
  const lines: Array<{ ok: boolean | 'partial'; text: string }> = [
    { ok: true, text: 'Profile, voice, platform styles and guardrails replaced.' }
  ]
  if (summary.linksRemoved.length > 0) {
    lines.push({ ok: true, text: `Removed links: ${summary.linksRemoved.join(', ')}.` })
  }
  lines.push({
    ok: true,
    text: [
      summary.goal === 'created' && 'New goal created and active.',
      summary.goal === 'reactivated' && 'The goal with this name was brought back and is active.',
      !summary.goal && 'No goal is active: add one in Goals before your next run.',
      summary.goalsPaused > 0 && `${plural(summary.goalsPaused, 'goal')} of ${oldName} paused.`
    ]
      .filter(Boolean)
      .join(' ')
  })
  const retired = [
    summary.knowledgeRemoved > 0 && `${plural(summary.knowledgeRemoved, 'knowledge document')} removed`,
    summary.ideasRejected > 0 && `${plural(summary.ideasRejected, 'open idea')} rejected`,
    summary.samplePostsRetired > 0 && `${plural(summary.samplePostsRetired, 'sample post')} switched off`,
    summary.insightsCleared > 0 && 'profile insights cleared',
    summary.newslettersRemoved > 0 && `${plural(summary.newslettersRemoved, 'newsletter suggestion')} removed`,
    summary.brandThemeReset && 'brand theme reset',
    summary.offeringsRetired > 0 && `${plural(summary.offeringsRetired, 'older offering')} switched off`,
    summary.audiencesRemoved > 0 && `${plural(summary.audiencesRemoved, 'older audience')} removed`
  ].filter(Boolean)
  if (retired.length > 0) {
    const text = retired.join(', ')
    lines.push({ ok: true, text: `${text.charAt(0).toUpperCase()}${text.slice(1)}.` })
  }
  if (knowledge) {
    lines.push({
      ok:
        knowledge.status === 'failed'
          ? false
          : knowledge.status === 'partial'
            ? 'partial'
            : true,
      text: `Knowledge: ${knowledge.message}${
        knowledge.status === 'failed' || knowledge.status === 'partial'
          ? ' Pages not added stay in your AI suggestions to try again.'
          : ''
      }`
    })
  }
  if (summary.autoPublishOff.length > 0) {
    lines.push({
      ok: 'partial',
      text: `Auto-publish turned off for ${summary.autoPublishOff
        .map(c => `${PLATFORMS[c.platform]?.label ?? c.platform}${c.name ? ` (${c.name})` : ''}`)
        .join(', ')}. Check these accounts belong to the new company in Settings → Integrations before turning it back on.`
    })
  }
  lines.push({
    ok: true,
    text: `Kept: ${[
      posts > 0 && plural(posts, 'post'),
      'published history and past runs',
      followedNewsletters > 0 && `${plural(followedNewsletters, 'newsletter')} you saved or signed up to`
    ]
      .filter(Boolean)
      .join(', ')}.`
  })

  return (
    <ul className="space-y-2">
      {lines.map(line => (
        <li
          key={line.text}
          className={`flex items-start gap-2.5 rounded-lg p-3 text-sm ${
            line.ok === false
              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
              : line.ok === 'partial'
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {line.ok === false ? (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : line.ok === 'partial' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  )
}
