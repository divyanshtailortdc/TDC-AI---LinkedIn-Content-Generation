import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'
import { isTestDomain } from './lib/mail/test-domain'

export const env = createEnv({
  server: {
    APP_ENV: z
      .enum(['development', 'staging', 'production'])
      .default('development'),
    // Which work this process does: 'web' serves pages and only queues runs,
    // 'worker' runs the job worker and the scheduler, 'all' does both (as in
    // `next dev`). terraform/ can split them (separate_worker).
    APP_ROLE: z.enum(['all', 'web', 'worker']).default('all'),
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
    // Inbox: our own mail server (mailserver/README.md). Every address at
    // INBOUND_EMAIL_DOMAIN (inbox.tdcai.com in production) delivers into one
    // IMAP mailbox the app reads. Unset, the inbox is off. Production refuses
    // the reserved test domains (.test, example.com, …): nobody can send to
    // them, so the addresses people subscribe with would never receive mail.
    INBOUND_EMAIL_DOMAIN: z
      .string()
      .regex(/^[a-z0-9.-]+\.[a-z0-9-]+$/i, 'INBOUND_EMAIL_DOMAIN must be a domain')
      .refine(
        domain => process.env.APP_ENV !== 'production' || !isTestDomain(domain),
        'INBOUND_EMAIL_DOMAIN must be a real domain in production'
      )
      .optional(),
    MAIL_IMAP_HOST: z.string().optional(),
    MAIL_IMAP_PORT: z.coerce.number().int().positive().default(993),
    MAIL_IMAP_USER: z.string().optional(),
    MAIL_IMAP_PASSWORD: z.string().optional(),
    /** Local only: the CA that signed a self-signed server certificate. */
    MAIL_IMAP_TLS_CA_FILE: z.string().optional(),
    // Inbox through Cloudflare Email Routing (cloudflare/email-worker/README.md):
    // the secret the Email Worker signs each email it posts to
    // /api/mail/inbound with. Unset, that route is off. Works with or without IMAP.
    MAIL_WEBHOOK_SECRET: z
      .string()
      .min(32, 'MAIL_WEBHOOK_SECRET must be at least 32 characters')
      .optional(),
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
    APP_ROLE: process.env.APP_ROLE,
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
    INBOUND_EMAIL_DOMAIN: process.env.INBOUND_EMAIL_DOMAIN,
    MAIL_IMAP_HOST: process.env.MAIL_IMAP_HOST,
    MAIL_IMAP_PORT: process.env.MAIL_IMAP_PORT,
    MAIL_IMAP_USER: process.env.MAIL_IMAP_USER,
    MAIL_IMAP_PASSWORD: process.env.MAIL_IMAP_PASSWORD,
    MAIL_IMAP_TLS_CA_FILE: process.env.MAIL_IMAP_TLS_CA_FILE,
    MAIL_WEBHOOK_SECRET: process.env.MAIL_WEBHOOK_SECRET,
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
