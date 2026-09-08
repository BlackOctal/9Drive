import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { hashToken, randomToken } from '@/lib/server/crypto'
import { getSessionClaims } from '@/lib/server/session'
import { buildConsentUrl } from '@/lib/server/providers/google'
import { nextFreeBay } from '@/lib/server/bays'
import { apiHandler } from '@/lib/server/api'

/**
 * Starts a Google consent flow.
 *
 * `flow=login` signs a person in (and attaches their first Drive as a side
 * effect). `flow=connect` attaches drives 2..N to whoever is already signed in.
 * The distinction is carried in the state row, not the query string, so it
 * cannot be tampered with on the way back.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const claims = await getSessionClaims()
  const requested = req.nextUrl.searchParams.get('flow')
  const flow = claims && requested !== 'login' ? 'connect' : 'login'
  const returnTo = req.nextUrl.searchParams.get('returnTo') ?? (flow === 'connect' ? '/accounts' : '/')

  // Reserve the slot now so the consent screen and the callback agree on
  // which bay, and so the right OAuth client is used for both legs.
  const bayIndex = flow === 'connect' ? await nextFreeBay(claims!.sub) : 1

  const state = randomToken()
  await prisma.oauthState.create({
    data: {
      userId: flow === 'connect' ? claims!.sub : null,
      flow,
      bayIndex,
      stateHash: hashToken(state),
      returnTo: returnTo.startsWith('/') ? returnTo : '/',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  })

  const url = buildConsentUrl(state, bayIndex)
  if (req.nextUrl.searchParams.get('redirect') === '1') return NextResponse.redirect(url)
  return NextResponse.json({ url })
})
