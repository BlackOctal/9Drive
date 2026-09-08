import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { apiHandler, fail, log } from '@/lib/server/api'

export const runtime = 'nodejs'

const schema = z.object({
  /** 16 random bytes, base64. Generated in the browser. */
  salt: z.string().min(16).max(64),
  /** A known string encrypted under the derived key. */
  verifier: z.string().min(16).max(512),
})

/**
 * Records the vault's public parameters.
 *
 * Note what is absent: the passphrase, and the key derived from it. Both stay
 * in the browser. This route could not decrypt a vault file if it wanted to,
 * which is the property that makes the vault worth having.
 *
 * Setup is once and only once. Overwriting the salt would silently orphan
 * every existing file's wrapped key, so a second attempt is refused.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const userId = await requireUserId()
  const { salt, verifier } = schema.parse(await req.json())

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { vaultSalt: true, vaultVerifier: true },
  })
  if (user.vaultSalt && user.vaultVerifier) {
    return fail(409, 'This vault is already set up.', 'VAULT_EXISTS')
  }

  await prisma.user.update({ where: { id: userId }, data: { vaultSalt: salt, vaultVerifier: verifier } })
  await log(userId, 'vault.setup', 'vault', userId)

  return NextResponse.json({ ok: true }, { status: 201 })
})
