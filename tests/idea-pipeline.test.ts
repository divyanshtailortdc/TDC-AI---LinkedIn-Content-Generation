import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  validateIdea,
  extractNumbers,
  detectFabricatedAnecdote,
  qualifyUnsupportedAbsolutes,
  checkClaimDirectSupport,
  type GroundingCorpus
} from '../src/lib/ai/idea-validator'
import {
  filterDiverseIdeas,
  calculateThesisSimilarity,
  isGenericIntegrationComplexityThesis
} from '../src/lib/ai/idea-diversity'
import type { GeneratedIdeaItem } from '../src/lib/ai/schemas'

const mockCorpus: GroundingCorpus = {
  verifiedClaims: [
    {
      claim: '77% of enterprise distributors experience inventory discrepancies due to manual cross-system sync.',
      quote: '77% of enterprise distributors experience inventory discrepancies due to manual cross-system sync.',
      sourceTitle: 'ThinkSys Supply Chain Benchmark 2026',
      sourceUrl: 'https://thinksys.com/benchmark-2026',
      sourceId: 'doc-1',
      isFresh: false
    },
    {
      claim: 'Unifying operational workflows cuts order latency by 62% across $1.2M distribution pipelines.',
      quote: 'Unifying operational workflows cuts order latency by 62% across $1.2M distribution pipelines.',
      sourceTitle: 'Operational Efficiency Case Study',
      sourceUrl: 'https://example.com/case-study',
      sourceId: 'doc-2',
      isFresh: false
    }
  ],
  knownNumbers: ['77%', '62%', '$1.2M'],
  knownProductNames: ['FlowERP'],
  hasFreshEvidence: false // No fresh news / launches in corpus
}

describe('AI Idea Pipeline - Quality, Grounding, and Diversity Refinements', () => {
  // Test 1: Unsupported claim does not receive 100% grounding
  it('1. Unsupported claim does not receive 100% grounding', () => {
    const ungroundedIdea: GeneratedIdeaItem = {
      title: 'Supply Chain Friction',
      thesis: 'Manual sync introduces systematic reconciliation lag.',
      perspectiveAngle: 'operational_problems',
      angle: 'Operational latency analysis',
      pillar: 'Operations',
      format: 'thought_leadership',
      whyNow: 'Modern enterprise supply chains face compounding handoff delays.',
      hookConcept: 'Here is what happens when databases fall out of sync:',
      coreArgument: 'Discrepancies compound when systems do not synchronize deterministically.',
      audienceTakeaway: 'Audit your database sync intervals.',
      supportingEvidence: [
        {
          claim: '77% of enterprise distributors experience inventory discrepancies due to manual cross-system sync.',
          factType: 'verified',
          confidence: 0.95
        },
        {
          // Hallucinated claim not in corpus:
          claim: 'Over 94% of warehouse staff quit within 90 days due to clunky software.',
          factType: 'verified',
          confidence: 0.9
        }
      ],
      suggestedMedia: { mode: 'none' },
      noveltyNote: 'Focuses on structural friction',
      estimatedStrength: 85,
      groundingScore: 85,
      originalityScore: 85,
      unsupportedClaims: [],
      sourceIds: [],
      risks: []
    }

    const res = validateIdea(ungroundedIdea, mockCorpus)

    assert.strictEqual(res.sanitized, true)
    // The grounding score must NEVER be 100% or high when unsupported claims exist
    assert.ok(
      res.groundingScore < 80,
      `Grounding score should be < 80 for ideas with unsupported claims, got ${res.groundingScore}`
    )
    assert.ok(
      res.unsupportedClaims.some((c) => c.includes('94%') || c.includes('Unsupported')),
      'Should flag unsupported claim'
    )
  })

  // Test 2: Fabricated first-person anecdote is rejected / neutralized
  it('2. Fabricated first-person anecdote is detected and neutralized', () => {
    const check1 = detectFabricatedAnecdote(
      'We crossed around 50 customers and realized our spreadsheet was failing.',
      []
    )
    assert.strictEqual(check1.detected, true)
    assert.ok(check1.snippet?.includes('We crossed'))

    const ideaWithAnecdote: GeneratedIdeaItem = {
      title: 'Warehouse Scale Realities',
      thesis: 'Process failure happens between shifts.',
      perspectiveAngle: 'operational_problems',
      angle: 'Field observations',
      pillar: 'Operations',
      format: 'thought_leadership',
      whyNow: 'Operating margins are thinning.',
      hookConcept: 'We worked with a distributor and saw them lose an entire shipment because two spreadsheets did not match.',
      coreArgument: 'When teams rely on informal handoffs, inventory diverges.',
      audienceTakeaway: 'Standardize shift-handover protocols.',
      supportingEvidence: [],
      suggestedMedia: { mode: 'none' },
      noveltyNote: 'Direct field lesson',
      estimatedStrength: 85,
      groundingScore: 85,
      originalityScore: 85,
      unsupportedClaims: [],
      sourceIds: [],
      risks: []
    }

    const res = validateIdea(ideaWithAnecdote, mockCorpus)

    assert.strictEqual(res.hasFabricatedAnecdote, true)
    assert.ok(
      res.unsupportedClaims.some((c) => c.includes('Fabricated anecdote detected')),
      'Should flag fabricated anecdote'
    )
    // Must neutralize "We worked with" to objective observation
    assert.ok(!res.idea.hookConcept.includes('We worked with'))
    assert.ok(res.idea.hookConcept.includes('Industry case studies show') || res.idea.hookConcept.includes('Distributors often encounter'))
  })

  // Test 3: Unsupported absolute claim is rewritten / qualified
  it('3. Unsupported absolute claim is rewritten/qualified', () => {
    const rawSentence = 'Dual sources of truth always diverge, and every integration multiplies handoff points.'
    const result = qualifyUnsupportedAbsolutes(rawSentence, [])

    assert.strictEqual(result.modified, true)
    // Should qualify "always diverge" and "every integration multiplies"
    assert.ok(!result.qualifiedText.includes('always diverge'))
    assert.ok(result.qualifiedText.includes('can create synchronization and consistency challenges'))
    assert.ok(result.qualifiedText.includes('additional integrations can introduce more'))

    const ideaWithAbsolutes: GeneratedIdeaItem = {
      title: 'Integration Fallacies',
      thesis: 'Dual sources of truth always diverge.',
      perspectiveAngle: 'technology_architecture',
      angle: 'Data architecture',
      pillar: 'Tech',
      format: 'thought_leadership',
      whyNow: 'Architectures compound in complexity.',
      hookConcept: 'Every integration multiplies failure points and proves that point solutions fail.',
      coreArgument: 'Dual sources of truth always diverge because state synchronisation is impossible to guarantee.',
      audienceTakeaway: 'Evaluate domain ownership boundaries.',
      supportingEvidence: [],
      suggestedMedia: { mode: 'none' },
      noveltyNote: 'Architecture trade-offs',
      estimatedStrength: 85,
      groundingScore: 85,
      originalityScore: 85,
      unsupportedClaims: [],
      sourceIds: [],
      risks: []
    }

    const valRes = validateIdea(ideaWithAbsolutes, mockCorpus)
    assert.strictEqual(valRes.hasUnsupportedAbsolutes, true)
    assert.ok(!valRes.idea.thesis.includes('always diverge'))
    assert.ok(valRes.idea.thesis.includes('can create synchronization and consistency challenges'))
  })

  // Test 4: Current/trend claim without fresh evidence is rejected or qualified
  it('4. Current/trend claim without fresh evidence is qualified', () => {
    const ideaWithStaleWhyNow: GeneratedIdeaItem = {
      title: 'Supply Chain Alert',
      thesis: 'Integration latency compounds operational friction.',
      perspectiveAngle: 'technology_architecture',
      angle: 'Architecture review',
      pillar: 'Tech',
      format: 'thought_leadership',
      whyNow: 'B2B operators are currently hitting breaking points as the market is increasingly demanding real-time fulfillment.',
      hookConcept: 'Here is why latency compounds across supply chains:',
      coreArgument: 'Point-to-point APIs create synchronization lag.',
      audienceTakeaway: 'Evaluate event-driven alternatives.',
      supportingEvidence: [],
      suggestedMedia: { mode: 'none' },
      noveltyNote: 'Timely architecture shift',
      estimatedStrength: 85,
      groundingScore: 85,
      originalityScore: 85,
      unsupportedClaims: [],
      sourceIds: [],
      risks: []
    }

    const res = validateIdea(ideaWithStaleWhyNow, mockCorpus)

    assert.strictEqual(res.hasStaleWhyNow, true)
    assert.ok(
      res.unsupportedClaims.some((c) => c.includes('Unverified temporal urgency in Why Now')),
      'Should flag false urgency in whyNow'
    )
    assert.ok(!res.idea.whyNow.includes('currently hitting'))
    assert.ok(res.idea.whyNow.includes('frequently encounter') || res.idea.whyNow.includes('modern industry'))
  })

  // Test 5: Directly supported claim can receive high grounding (85-100%)
  it('5. Directly supported claim receives high grounding score', () => {
    const directlySupportedIdea: GeneratedIdeaItem = {
      title: 'The 77% Inventory Discrepancy Paradox',
      thesis: '77% of enterprise distributors experience inventory discrepancies due to manual cross-system sync.',
      perspectiveAngle: 'operational_problems',
      angle: 'Inventory reconciliation benchmark',
      pillar: 'Operations',
      format: 'thought_leadership',
      whyNow: 'Cross-system sync creates persistent inventory discrepancies in distribution pipelines.',
      hookConcept: '77% of enterprise distributors experience inventory discrepancies due to manual cross-system sync.',
      coreArgument: 'Unifying operational workflows cuts order latency by 62% across $1.2M distribution pipelines.',
      audienceTakeaway: 'Audit your cross-system manual sync points.',
      supportingEvidence: [
        {
          claim: '77% of enterprise distributors experience inventory discrepancies due to manual cross-system sync.',
          quote: '77% of enterprise distributors experience inventory discrepancies due to manual cross-system sync.',
          factType: 'verified',
          sourceTitle: 'ThinkSys Supply Chain Benchmark 2026',
          sourceUrl: 'https://thinksys.com/benchmark-2026',
          confidence: 0.95
        },
        {
          claim: 'Unifying operational workflows cuts order latency by 62% across $1.2M distribution pipelines.',
          quote: 'Unifying operational workflows cuts order latency by 62% across $1.2M distribution pipelines.',
          factType: 'verified',
          sourceTitle: 'Operational Efficiency Case Study',
          sourceUrl: 'https://example.com/case-study',
          confidence: 0.95
        }
      ],
      suggestedMedia: { mode: 'none' },
      noveltyNote: 'Backed directly by empirical benchmarks',
      estimatedStrength: 95,
      groundingScore: 85,
      originalityScore: 85,
      unsupportedClaims: [],
      sourceIds: [],
      risks: []
    }

    const res = validateIdea(directlySupportedIdea, mockCorpus)

    assert.strictEqual(res.unsupportedClaims.length, 0)
    assert.ok(
      res.groundingScore >= 85,
      `Directly supported idea should receive groundingScore >= 85, got ${res.groundingScore}`
    )
    assert.strictEqual(res.isValid, true)
  })

  // Test 6: Multiple ideas with the same thesis are caught by diversity validation
  it('6. Multiple ideas with the same thesis are caught by diversity validation', () => {
    const ideaA: GeneratedIdeaItem = {
      title: 'Why Disconnected Systems Break Operations',
      thesis: 'Too many disconnected systems and siloed systems create massive integration overhead and data silos.',
      perspectiveAngle: 'technology_architecture',
      angle: 'System fragmentation',
      pillar: 'Architecture',
      format: 'thought_leadership',
      whyNow: 'Siloed tools are multiplying.',
      hookConcept: 'When each department buys its own tool, integration overhead explodes.',
      coreArgument: 'Point solutions create data silos and sync issues that require constant reconciliation.',
      audienceTakeaway: 'Audit your tool count.',
      supportingEvidence: [],
      suggestedMedia: { mode: 'none' },
      noveltyNote: 'System sprawl analysis',
      estimatedStrength: 90,
      groundingScore: 78,
      originalityScore: 85,
      unsupportedClaims: [],
      sourceIds: [],
      risks: []
    }

    const ideaB: GeneratedIdeaItem = {
      title: 'The Silent Tax of Best-of-Breed Tooling',
      // Different wording, same repetitive macro-thesis!
      thesis: 'Multiple tools and siloed systems create an integration nightmare and reconciliation lag across operations.',
      perspectiveAngle: 'operational_problems',
      angle: 'Tool sprawl costs',
      pillar: 'Operations',
      format: 'thought_leadership',
      whyNow: 'SaaS stacks are growing.',
      hookConcept: 'Every point solution you add compounds integration overhead.',
      coreArgument: 'Disconnected systems create sync issues and reconciliation lag that sap productivity.',
      audienceTakeaway: 'Consolidate redundant tools.',
      supportingEvidence: [],
      suggestedMedia: { mode: 'none' },
      noveltyNote: 'Tool consolidation analysis',
      estimatedStrength: 84,
      groundingScore: 76,
      originalityScore: 82,
      unsupportedClaims: [],
      sourceIds: [],
      risks: []
    }

    assert.ok(isGenericIntegrationComplexityThesis(`${ideaA.thesis} ${ideaA.coreArgument}`))
    assert.ok(isGenericIntegrationComplexityThesis(`${ideaB.thesis} ${ideaB.coreArgument}`))

    const result = filterDiverseIdeas([ideaA, ideaB], 2)
    // Only one should survive; the second must be rejected for repetitive macro-thesis
    assert.strictEqual(result.selected.length, 1)
    assert.strictEqual(result.selected[0]?.title, ideaA.title)
    assert.strictEqual(result.rejected.length, 1)
    assert.ok(
      result.rejected[0]?.reason.includes('Duplicate macro-thesis') ||
      result.rejected[0]?.reason.includes('semantic thesis overlap')
    )
  })

  // Test 7: Evidence-backed but interpretive thesis is marked as inferred (60-79% grounding score)
  it('7. Evidence-backed but interpretive thesis is marked as inferred (60-79% grounding score)', () => {
    const interpretiveIdea: GeneratedIdeaItem = {
      title: 'The Latency Tax on Cross-Departmental Workflows',
      // General interpretive principle rather than verbatim quote
      thesis: 'Operational bottlenecks compound silently across organizational boundaries rather than task execution.',
      perspectiveAngle: 'operational_problems',
      angle: 'Handoff latency',
      pillar: 'Operations',
      format: 'thought_leadership',
      whyNow: 'Distributed teams require explicit workflow boundaries.',
      hookConcept: 'Most operational delays do not happen during work execution, but in the dead time between handoffs.',
      coreArgument: 'Unifying operational workflows cuts order latency by 62% by eliminating handoff friction.',
      audienceTakeaway: 'Map your team handoffs.',
      supportingEvidence: [
        {
          claim: 'Unifying operational workflows cuts order latency by 62% across $1.2M distribution pipelines.',
          quote: 'Unifying operational workflows cuts order latency by 62% across $1.2M distribution pipelines.',
          factType: 'verified',
          confidence: 0.95
        }
      ],
      suggestedMedia: { mode: 'none' },
      noveltyNote: 'Handoff wait-time focus',
      estimatedStrength: 88,
      groundingScore: 85,
      originalityScore: 85,
      unsupportedClaims: [],
      sourceIds: [],
      risks: []
    }

    const res = validateIdea(interpretiveIdea, mockCorpus)

    // Thesis is inferred from evidence rather than explicitly quoted
    assert.strictEqual(res.inferredClaims.length > 0, true)
    assert.ok(
      res.groundingScore >= 60 && res.groundingScore <= 79,
      `Interpretive idea must receive grounding score in 60-79% range, got ${res.groundingScore}`
    )
    // Crucially: it must NOT be 100% or 95%
    assert.ok(res.groundingScore < 80, 'Must not be falsely marked as 100% or 85%+ grounded')
    assert.strictEqual(res.isValid, true)
  })
})
