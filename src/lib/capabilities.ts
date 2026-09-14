import { env } from '@/env'

export type Capability = {
  name: string
  description: string
  status: 'live' | 'missing'
  missingKey?: string
}

export function getCapabilities(): Capability[] {
  return [
    {
      name: 'Anthropic (Claude)',
      description: 'AI research, ideation, and post drafting',
      status: env.ANTHROPIC_API_KEY ? 'live' : 'missing',
      missingKey: 'ANTHROPIC_API_KEY'
    },
    {
      name: 'Serper',
      description: 'Web search and stock image sourcing',
      status: env.SERPER_API_KEY ? 'live' : 'missing',
      missingKey: 'SERPER_API_KEY'
    },
    {
      name: 'Image Generation',
      description: 'AI-generated post images via AI Gateway',
      status: env.AI_GATEWAY_API_KEY ? 'live' : 'missing',
      missingKey: 'AI_GATEWAY_API_KEY'
    }
  ]
}
