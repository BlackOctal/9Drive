import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { env, GOOGLE_SCOPES } from '@/lib/server/env'
import { encrypt, hashPassword, hashToken, randomToken } from '@/lib/server/crypto'
import { startSession } from '@/lib/server/session'
import { exchangeCode, fetchProfile, syncQuota } from '@/lib/server/providers/google'
import { nextFreeBay } from '@/lib/server/bays'
import { log } from '@/lib/server/api'

function back(path: string, params: Record<string, string> = {}) {
  const url = new URL(path, env.APP_URL)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

/**
 * Handles the return leg of both flows. This route redirects rather than
 * returning JSON — the browser lands here directly from Google.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const denied = req.nextUrl.searchParams.get('error')

  if (denied) return back('/login', { error: 'Google sign-in was cancelled.' })
  if (!code || !state) return back('/login', { error: 'Google sent an incomplete response.' })

  try {
    const stateRow = await prisma.oauthState.findUnique({ where: { stateHash: hashToken(state) } })
    if (!stateRow || stateRow.usedAt || stateRow.expiresAt < new Date()) {
      return back('/login', { error: 'That sign-in link expired. Try again.' })
    }
    await prisma.oauthState.update({ where: { id: stateRow.id }, data: { usedAt: new Date() } })

    const tokens = await exchangeCode(code, stateRow.bayIndex)
    const profile = await fetchProfile(tokens.access_token)
    if (!profile.email) return back('/login', { error: 'Google did not share an email address.' })

    // Resolve the owner: an existing session for connect, upsert for login.
    let userId = stateRow.userId
    if (!userId) {
      if (env.ALLOWED_EMAIL && env.ALLOWED_EMAIL.toLowerCase() !== profile.email.toLowerCase()) {
        const existing = await prisma.user.findUnique({ where: { email: profile.email }, select: { id: true } })
        if (!existing) return back('/login', { error: 'Sign-ups are closed on this instance.' })
        userId = existing.id
      } else {
        const user = await prisma.user.upsert({
          where: { email: profile.email },
          create: {
            email: profile.email,
            name: profile.name || profile.email.split('@')[0],
            avatarUrl: profile.picture,
            // Google-only accounts get an unguessable password they never use.
            passwordHash: await hashPassword(randomToken(48)),
          },
          update: { avatarUrl: profile.picture },
        })
        userId = user.id
      }
    }

    const existingAccount = await prisma.connectedAccount.findUnique({
      where: { userId_provider_providerAccountId: { userId, provider: 'google_drive', providerAccountId: profile.id } },
    })

    // Google only issues a refresh token on first consent. Reuse the stored one
    // on reconnect rather than orphaning the account.
    const refreshEncrypted = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : existingAccount?.refreshTokenEncrypted
    if (!refreshEncrypted) {
      return back(stateRow.returnTo, { error: 'Google did not return a refresh token. Remove this app at myaccount.google.com/permissions, then reconnect.' })
    }

    const shared = {
      email: profile.email,
      displayName: profile.name,
      avatarUrl: profile.picture,
      accessTokenEncrypted: encrypt(tokens.access_token),
      refreshTokenEncrypted: refreshEncrypted,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: tokens.scope?.split(' ') ?? GOOGLE_SCOPES,
      status: 'connected',
      lastError: null,
    }

    // Reconnecting keeps its original bay; a new drive takes the reserved one.
    // The reservation can go stale if two tabs raced, so it is re-checked.
    const bayIndex = existingAccount?.bayIndex ?? (await nextFreeBay(userId))

    const account = await prisma.connectedAccount.upsert({
      where: { userId_provider_providerAccountId: { userId, provider: 'google_drive', providerAccountId: profile.id } },
      create: { userId, provider: 'google_drive', providerAccountId: profile.id, bayIndex, ...shared },
      update: shared,
    })

    await syncQuota(account.id)
    await log(userId, existingAccount ? 'drive.reconnect' : 'drive.connect', 'drive', account.id, {
      email: profile.email,
      bay: bayIndex,
    })

    if (stateRow.flow === 'login') await startSession(userId, { userAgent: req.headers.get('user-agent') ?? undefined })
    return back(stateRow.returnTo, { connected: profile.email, bay: String(bayIndex) })
  } catch (error) {
    console.error('[google callback]', error)
    return back('/login', { error: error instanceof Error ? error.message : 'Google sign-in failed.' })
  }
}
