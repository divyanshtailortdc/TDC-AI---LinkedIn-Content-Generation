import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  AccountIdSchema,
  GoalPayloadSchema,
  KnowledgeDocumentSchema,
  parseSetupPayload,
  PreferencesPayloadSchema
} from '../src/lib/setup-payloads'

const id = '8f14e45f-ceea-4e7a-9a3b-0c9a5b6d7e8f'
const goal = {
  title: 'Book calls',
  objectiveType: 'lead_gen',
  keyMessage: 'Clean books help founders decide',
  desiredAction: '',
  targetUrl: '',
  linkStrategy: 'first_comment'
}
const prefs = {
  pillars: [{ name: 'Close', weight_pct: 50, example_topics: ['a'] }],
  ideasPerRun: 5,
  post_constraints: { cta_required: true },
  guardrails: { banned_topics: ['x'], compliance_notes: '' }
}
const doc = {
  accountId: id,
  title: 'T',
  sourceType: 'url',
  sourceUrl: 'https://example.com/a',
  content: 'body'
}
const bad = (schema: Parameters<typeof parseSetupPayload>[0], value: unknown) =>
  assert.throws(() => parseSetupPayload(schema, value))

describe('setup payloads', () => {
  it('accepts what the forms send', () => {
    parseSetupPayload(AccountIdSchema, id)
    parseSetupPayload(GoalPayloadSchema, goal)
    parseSetupPayload(PreferencesPayloadSchema, prefs)
    parseSetupPayload(KnowledgeDocumentSchema, doc)
    // A saved artifact has no source URL.
    parseSetupPayload(KnowledgeDocumentSchema, { ...doc, sourceType: 'artifact', sourceUrl: undefined })
  })

  it('rejects an account id that is not a uuid', () => {
    bad(AccountIdSchema, "1' or '1'='1")
    bad(KnowledgeDocumentSchema, { ...doc, accountId: 'nope' })
  })

  it('rejects malformed goals', () => {
    bad(GoalPayloadSchema, { ...goal, objectiveType: 'viral' })
    bad(GoalPayloadSchema, { ...goal, linkStrategy: 'inline' })
    bad(GoalPayloadSchema, { ...goal, targetUrl: 'javascript:alert(1)' })
    bad(GoalPayloadSchema, { ...goal, title: 'x'.repeat(201) })
    bad(GoalPayloadSchema, { ...goal, keyMessage: 42 })
  })

  it('rejects malformed preferences', () => {
    bad(PreferencesPayloadSchema, { ...prefs, pillars: 'all' })
    bad(PreferencesPayloadSchema, { ...prefs, pillars: [{ name: 'a', weight_pct: Infinity }] })
    bad(PreferencesPayloadSchema, { ...prefs, pillars: Array(21).fill(prefs.pillars[0]) })
    bad(PreferencesPayloadSchema, { ...prefs, guardrails: { banned_topics: 'x', compliance_notes: '' } })
    bad(PreferencesPayloadSchema, { ...prefs, post_constraints: {} })
    bad(PreferencesPayloadSchema, { ...prefs, ideasPerRun: '5' })
  })

  it('rejects malformed knowledge documents', () => {
    bad(KnowledgeDocumentSchema, { ...doc, sourceType: 'file' })
    bad(KnowledgeDocumentSchema, { ...doc, sourceUrl: 'ftp://x.com/a' })
    bad(KnowledgeDocumentSchema, { ...doc, content: 'x'.repeat(200_001) })
  })

  it('reports the first problem in plain words', () => {
    assert.throws(
      () => parseSetupPayload(GoalPayloadSchema, { ...goal, targetUrl: 'nope' }),
      /URLs must start with http/
    )
  })
})
