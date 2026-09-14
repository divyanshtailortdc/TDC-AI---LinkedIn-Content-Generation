import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const env = createEnv({
  server: {
    APP_ENV: z
      .enum(['development', 'staging', 'production'])
      .default('development'),
    DATABASE_URL: z
      .string()
      .default(
        'postgresql://postgres:postgres@localhost:5432/tdc_linkedin_engine'
      ),
    ANTHROPIC_API_KEY: z.string().optional(),
    SERPER_API_KEY: z.string().optional(),
    AI_GATEWAY_API_KEY: z.string().optional(),
    CRON_SECRET: z.string().optional()
  },

  client: {
    NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000')
  },

  runtimeEnv: {
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL
  },

  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === 'true'
})
