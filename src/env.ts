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
    // How runs research the web: 'fixed' runs preset queries over snippets;
    // 'agent' lets the research agent choose searches and read pages.
    RESEARCH_MODE: z.enum(['fixed', 'agent']).default('fixed'),
    AI_GATEWAY_API_KEY: z.string().optional(),
    CRON_SECRET: z.string().optional(),

    // Authentication (see docs/AUTHENTICATION.md). Better Auth refuses to
    // start in production without a secret.
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters')
      .optional(),
    /** The URL people open the app at; Google/LinkedIn redirects and passkeys use it. */
    BETTER_AUTH_URL: z.url().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    LINKEDIN_CLIENT_ID: z.string().optional(),
    LINKEDIN_CLIENT_SECRET: z.string().optional(),
    /** Comma-separated auth user ids that are always admins (Admin plugin `adminUserIds`). */
    ADMIN_USER_IDS: z.string().optional(),
    // Post images, in any S3-compatible store (src/lib/media/image-store.ts).
    /** The bucket; unset keeps images in the database. */
    STORAGE_BUCKET: z.string().optional(),
    /** The store's S3 API, e.g. https://storage.googleapis.com; unset is AWS. */
    STORAGE_ENDPOINT: z.url().optional(),
    /** `auto` for Google Cloud Storage and R2; the bucket's region on AWS. */
    STORAGE_REGION: z.string().default('auto'),
    STORAGE_ACCESS_KEY_ID: z.string().optional(),
    STORAGE_SECRET_ACCESS_KEY: z.string().optional()
  },

  client: {
    NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000')
  },

  runtimeEnv: {
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    RESEARCH_MODE: process.env.RESEARCH_MODE,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
    ADMIN_USER_IDS: process.env.ADMIN_USER_IDS,
    STORAGE_BUCKET: process.env.STORAGE_BUCKET,
    STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT,
    STORAGE_REGION: process.env.STORAGE_REGION,
    STORAGE_ACCESS_KEY_ID: process.env.STORAGE_ACCESS_KEY_ID,
    STORAGE_SECRET_ACCESS_KEY: process.env.STORAGE_SECRET_ACCESS_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL
  },

  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === 'true'
})
