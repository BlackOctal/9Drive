import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { env } from './env'
import { prisma } from './prisma'
import { hashToken, randomToken } from './crypto'

const ACCESS_COOKIE = '9d_at'
const REFRESH_COOKIE = '9d_rt'
const ACCESS_TTL_SECONDS = 60 * 15
const REFRESH_TTL_DAYS = 30

const secret = new TextEncoder().encode(env.JWT_SECRET)

export type AccessClaims = { sub: string; sid: string }

async function signAccessToken(claims: AccessClaims) {
  return new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secret)
}

async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    if (!payload.sub || typeof payload.sid !== 'string') return null
    return { sub: payload.sub, sid: payload.sid }
  } catch {
    return null
  }
}

const baseCookie = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
}

/** Issues a fresh session pair and writes both cookies. */
export async function startSession(userId: string, meta: { userAgent?: string; ip?: string } = {}) {
  const refreshToken = randomToken()
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent?.slice(0, 255),
      ipAddress: meta.ip,
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000),
    },
  })

  const jar = await cookies()
  jar.set(ACCESS_COOKIE, await signAccessToken({ sub: userId, sid: session.id }), {
    ...baseCookie,
    maxAge: ACCESS_TTL_SECONDS,
  })
  jar.set(REFRESH_COOKIE, refreshToken, { ...baseCookie, maxAge: REFRESH_TTL_DAYS * 86400 })
  return session
}

export async function endSession() {
  const jar = await cookies()
  const refreshToken = jar.get(REFRESH_COOKIE)?.value
  if (refreshToken) {
    await prisma.session
      .updateMany({ where: { refreshTokenHash: hashToken(refreshToken) }, data: { revokedAt: new Date() } })
      .catch(() => undefined)
  }
  jar.delete(ACCESS_COOKIE)
  jar.delete(REFRESH_COOKIE)
}

/**
 * How long after a rotation the superseded token is still accepted.
 *
 * A browser sends several API calls at once and each carries whatever cookie
 * it held when it was sent. One of them rotates; the rest are already in
 * flight with the old token and cannot possibly know. Those are a race, not a
 * theft, and this window is what tells them apart.
 *
 * A token presented long after it was rotated is still treated as leaked. The
 * window only has to cover requests that overlap a single rotation.
 */
const ROTATION_GRACE_MS = 30_000

/**
 * Trades a valid refresh token for a new pair, invalidating the old one.
 *
 * If a token that was already rotated comes back *after the grace window*, it
 * has been replayed — which means it leaked. The whole session family is
 * revoked rather than served.
 */
async function rotate(): Promise<AccessClaims | null> {
  const jar = await cookies()
  const refreshToken = jar.get(REFRESH_COOKIE)?.value
  if (!refreshToken) return null

  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hashToken(refreshToken) } })
  if (!session) return null

  // Already dead. Say so without re-revoking the family on every request.
  if (session.revokedAt) return null
  if (session.expiresAt < new Date()) return null

  if (session.rotatedAt) {
    if (Date.now() - session.rotatedAt.getTime() < ROTATION_GRACE_MS) {
      // A sibling request rotated moments ago. Serve this one under the
      // superseded session — still unrevoked and unexpired — and let the
      // winner's cookies reach the browser on their own.
      return serveUnderSupersededSession(jar, session.userId, session.id)
    }

    await prisma.session.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return null
  }

  // Claim the rotation atomically: `rotated_at IS NULL` in the WHERE clause
  // means exactly one of N concurrent requests can win, however closely they
  // arrive. Without this two of them read null, both rotate, and the browser
  // ends up holding a token whose sibling is already orphaned.
  const claimed = await prisma.session.updateMany({
    where: { id: session.id, rotatedAt: null },
    data: { rotatedAt: new Date() },
  })
  if (claimed.count === 0) {
    return serveUnderSupersededSession(jar, session.userId, session.id)
  }

  const nextToken = randomToken()
  const next = await prisma.session.create({
    data: {
      userId: session.userId,
      refreshTokenHash: hashToken(nextToken),
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      expiresAt: session.expiresAt,
    },
  })

  const claims = { sub: session.userId, sid: next.id }
  jar.set(ACCESS_COOKIE, await signAccessToken(claims), { ...baseCookie, maxAge: ACCESS_TTL_SECONDS })
  jar.set(REFRESH_COOKIE, nextToken, { ...baseCookie, maxAge: REFRESH_TTL_DAYS * 86400 })
  return claims
}

/**
 * Serves a request that lost the rotation race.
 *
 * The refresh cookie is deliberately left alone — this request does not hold
 * the winner's token and must not overwrite it. A fresh access token is issued
 * against the superseded session so the next request skips this path entirely
 * rather than paying three more database round trips.
 */
async function serveUnderSupersededSession(
  jar: Awaited<ReturnType<typeof cookies>>,
  userId: string,
  sessionId: string,
): Promise<AccessClaims> {
  const claims = { sub: userId, sid: sessionId }
  jar.set(ACCESS_COOKIE, await signAccessToken(claims), { ...baseCookie, maxAge: ACCESS_TTL_SECONDS })
  return claims
}

/**
 * Authenticates from the refresh token without consuming it.
 *
 * A Server Component render cannot set cookies — Next.js throws — so it cannot
 * rotate. It can still establish who the caller is: the refresh token is
 * checked and the existing session is reported as-is, with nothing written.
 * The real rotation happens on the next route handler request, which is
 * allowed to set cookies, and which every page reaches within moments of
 * mounting.
 *
 * Note what is deliberately absent: the replayed-token family revocation. In
 * this path a rotated token is ambiguous — it could be a render that raced an
 * API call that legitimately rotated a moment earlier. Revoking on that would
 * sign people out for navigating. A replay seen by `rotate` is unambiguous,
 * so the revocation stays there.
 */
async function readClaimsWithoutRotation(): Promise<AccessClaims | null> {
  const jar = await cookies()
  const refreshToken = jar.get(REFRESH_COOKIE)?.value
  if (!refreshToken) return null

  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hashToken(refreshToken) } })
  if (!session) return null
  if (session.rotatedAt || session.revokedAt) return null
  if (session.expiresAt < new Date()) return null

  return { sub: session.userId, sid: session.id }
}

/**
 * Returns the current user id, silently refreshing an expired access token.
 *
 * @param rotate Pass false from a Server Component. Rotation writes cookies,
 *   and a render that tries to set one crashes the request.
 */
export async function getSessionClaims({ rotate: allowRotation = true } = {}): Promise<AccessClaims | null> {
  const jar = await cookies()
  const access = jar.get(ACCESS_COOKIE)?.value
  if (access) {
    const claims = await verifyAccessToken(access)
    if (claims) {
      const live = await prisma.session.findUnique({
        where: { id: claims.sid },
        select: { revokedAt: true, expiresAt: true },
      })
      if (live && !live.revokedAt && live.expiresAt > new Date()) return claims
    }
  }
  return allowRotation ? rotate() : readClaimsWithoutRotation()
}

export async function getCurrentUser(options: { rotate?: boolean } = {}) {
  const claims = await getSessionClaims(options)
  if (!claims) return null
  return prisma.user.findFirst({
    where: { id: claims.sub, status: 'active' },
    select: { id: true, name: true, email: true, avatarUrl: true, createdAt: true },
  })
}

export class Unauthorized extends Error {
  constructor() {
    super('Sign in to continue.')
  }
}

/** Throws Unauthorized. Route handlers should catch it via `apiHandler`. */
export async function requireUserId(): Promise<string> {
  const claims = await getSessionClaims()
  if (!claims) throw new Unauthorized()
  return claims.sub
}
