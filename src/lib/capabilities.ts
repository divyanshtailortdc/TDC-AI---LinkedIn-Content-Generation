import { env } from '@/env'

export type Capability = {
  name: string
  description: string
  status: 'live' | 'missing'
  missingKey?: string
}

export function getCapabilities(): Capability[] {
  const hasAnthropicDirect = Boolean(
    env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim().length > 0
  )
  const hasAIGateway = Boolean(
    env.AI_GATEWAY_API_KEY && env.AI_GATEWAY_API_KEY.trim().length > 0
  )
  const hasSerper = Boolean(
    env.SERPER_API_KEY && env.SERPER_API_KEY.trim().length > 0
  )

  const aiReady = hasAnthropicDirect || hasAIGateway

  return [
    {
      name: 'Anthropic (Claude)',
      description: hasAIGateway
        ? 'AI research, ideation, and post drafting via Vercel AI Gateway'
        : 'AI research, ideation, and post drafting',
      status: aiReady ? 'live' : 'missing',
      missingKey: 'ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY'
    },
    {
      name: 'Serper',
      description: 'Web search and stock image sourcing',
      status: hasSerper ? 'live' : 'missing',
      missingKey: 'SERPER_API_KEY'
    },
    {
      name: 'Image Generation',
      description: 'AI-generated post images via AI Gateway',
      status: hasAIGateway ? 'live' : 'missing',
      missingKey: 'AI_GATEWAY_API_KEY'
    }
  ]
}
