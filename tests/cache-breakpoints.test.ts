import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  EPHEMERAL_CACHE,
  splitForCache,
  withRollingCacheBreakpoint
} from '../src/lib/ai/cache-breakpoints'
import { GOAL_HEADING } from '../src/lib/ai/skills/post-drafting/prompt'

type Message = {
  role: string
  content: string
  providerOptions?: Record<string, Record<string, unknown> | undefined>
}

const marked = (message: { providerOptions?: Record<string, unknown> }) =>
  Boolean(
    (message.providerOptions?.anthropic as { cacheControl?: unknown } | undefined)
      ?.cacheControl
  )

describe('cache breakpoints in an agent loop', () => {
  it('marks only the newest message, moving the marker step by step', () => {
    const step1 = withRollingCacheBreakpoint<Message>([
      { role: 'user', content: 'Research this topic.' }
    ])
    assert.deepStrictEqual(step1.map(marked), [true])

    const step2 = withRollingCacheBreakpoint<Message>([
      ...step1,
      { role: 'assistant', content: 'searching' },
      { role: 'tool', content: 'results' }
    ])
    assert.deepStrictEqual(step2.map(marked), [false, false, true])
  })

  it('keeps any other provider options a message carries', () => {
    const [message] = withRollingCacheBreakpoint<Message>([
      {
        role: 'user',
        content: 'x',
        providerOptions: { anthropic: { other: 1 }, gateway: { order: ['a'] } }
      }
    ])
    assert.deepStrictEqual(message!.providerOptions, {
      anthropic: { other: 1, ...EPHEMERAL_CACHE.anthropic },
      gateway: { order: ['a'] }
    })
    const [older] = withRollingCacheBreakpoint<Message>([message!, { role: 'tool', content: 'y' }])
    assert.deepStrictEqual(older!.providerOptions, {
      anthropic: { other: 1 },
      gateway: { order: ['a'] }
    })
  })

  it('never changes what the messages say', () => {
    const messages: Message[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' }
    ]
    const out = withRollingCacheBreakpoint(messages)
    assert.deepStrictEqual(
      out.map(m => [m.role, m.content]),
      messages.map(m => [m.role, m.content])
    )
    // The input is left as it was.
    assert.ok(!('providerOptions' in messages[1]!))
  })
})

describe('instructions cut for the cache', () => {
  it('cuts word for word before the goal, so the joined text is unchanged', () => {
    const text = `You are a ghostwriter.\n\nAUTHOR\nAcme\n\n${GOAL_HEADING}Win distributors.\n\nVOICE\nPlain.`
    const blocks = splitForCache(text, GOAL_HEADING)
    assert.strictEqual(blocks.length, 2)
    assert.strictEqual(blocks.join(''), text)
    assert.ok(blocks[1]!.startsWith(GOAL_HEADING))
    assert.ok(!blocks[0]!.includes('Win distributors'))
  })

  it('keeps one block when the marker is missing', () => {
    assert.deepStrictEqual(splitForCache('No goal here.', GOAL_HEADING), [
      'No goal here.'
    ])
  })
})
