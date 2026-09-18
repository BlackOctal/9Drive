import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  TOKEN_ENCRYPTION_KEY: z.string().min(32, 'must be at least 32 characters'),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ALLOWED_EMAIL: z.string().optional(),
  MAX_DRIVE_BAYS: z.coerce.number().int().min(1).max(64).default(15),
})

/**
 * Resolves APP_URL, falling back to the domain Vercel assigns the project.
 *
 * A first deploy is a chicken-and-egg problem: APP_URL cannot name a URL that
 * does not exist yet, but `next build` imports this module and fails without
 * it. Vercel exposes the project's *stable* production domain as
 * VERCEL_PROJECT_PRODUCTION_URL, which is exactly the value wanted here.
 *
 * Deliberately not VERCEL_URL. That one is unique per deployment, and this
 * value is both the OAuth redirect Google has been told about and the CORS
 * origin Google stamps on an upload session — a value that changes every
 * deploy breaks sign-in and every direct-to-Drive upload.
 *
 * An explicit APP_URL always wins; set it once a custom domain exists.
 */
function resolveAppUrl(): string | undefined {
  if (process.env.APP_URL) return process.env.APP_URL
  const productionDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return productionDomain ? `https://${productionDomain}` : undefined
}

const parsed = schema.safeParse({ ...process.env, APP_URL: resolveAppUrl() })

if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
  throw new Error(
    `Environment is not configured.\n${missing}\n\n` +
      `Locally: copy .env.example to .env and fill it in.\n` +
      `On Vercel: Project -> Settings -> Environment Variables, with Production ticked.`,
  )
}

export const env = parsed.data

export const GOOGLE_REDIRECT_URI = `${env.APP_URL}/api/auth/google/callback`

/**
 * The app data folder. Non-sensitive, and accessible only to the OAuth client
 * that created it — which is what hides the vault from the Drive interface and
 * from every other app.
 *
 * Adding this after a drive was connected means that drive's grant predates
 * the scope, so it must be reconnected. `accountHasVaultScope` detects that.
 */
export const APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  APPDATA_SCOPE,
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

export type BayCredentials = { clientId: string; clientSecret: string; dedicated: boolean }

/**
 * Resolves the OAuth client a given bay should use.
 *
 * One Google Cloud client can authorise all nine accounts, so bay 1's
 * credentials are the default for every bay. Setting GOOGLE_CLIENT_ID_3 gives
 * bay 3 its own client instead — worth doing if you want each drive on a
 * separate Cloud project so they don't share an API quota.
 */
export function credentialsForBay(bay: number): BayCredentials {
  if (bay <= 1) {
    return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, dedicated: true }
  }

  const clientId = process.env[`GOOGLE_CLIENT_ID_${bay}`]
  const clientSecret = process.env[`GOOGLE_CLIENT_SECRET_${bay}`]

  if (clientId && clientSecret) return { clientId, clientSecret, dedicated: true }
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, dedicated: false }
}

/** True when a bay has its own credential pair in the environment. */
export function bayHasDedicatedCredentials(bay: number): boolean {
  if (bay <= 1) return true
  return Boolean(process.env[`GOOGLE_CLIENT_ID_${bay}`] && process.env[`GOOGLE_CLIENT_SECRET_${bay}`])
}
