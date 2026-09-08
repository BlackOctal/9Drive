import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/server/prisma'
import { env } from '@/lib/server/env'
import { requireUserId } from '@/lib/server/session'
import { randomToken } from '@/lib/server/crypto'
import { selectAccount } from '@/lib/server/routing/select-account'
import { accountHasVaultScope, createVaultUploadSession } from '@/lib/server/providers/google'
import { MAX_VAULT_FILE_BYTES } from '@/lib/vault-limits'
import { apiHandler, fail } from '@/lib/server/api'

export const runtime = 'nodejs'
export const maxDuration = 30

const schema = z.object({
  /** Size of the *ciphertext*, which the browser already produced. */
  sizeBytes: z.string().regex(/^\d+$/, 'sizeBytes must be a digit string'),
})

/**
 * Phase one of a vault upload.
 *
 * Identical in shape to the ordinary upload path — the server mints a
 * resumable session URI and the browser PUTs to Google directly — with two
 * differences: the destination is the account's app data folder, and the name
 * Google is given is an opaque id. The real name travels encrypted, in the
 * completion call.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const userId = await requireUserId()
  const { sizeBytes: raw } = schema.parse(await req.json())
  const sizeBytes = BigInt(raw)

  if (sizeBytes <= 0n) return fail(400, 'That file is empty.', 'EMPTY')
  // Re-checked here: the browser cap is a courtesy, not an enforcement point.
  if (sizeBytes > BigInt(MAX_VAULT_FILE_BYTES) + 4096n) {
    return fail(413, 'Secret files are capped at 100 MB.', 'TOO_LARGE')
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { vaultSalt: true, vaultVerifier: true },
  })
  if (!user.vaultSalt || !user.vaultVerifier) {
    return fail(409, 'Set up the vault before uploading to it.', 'VAULT_NOT_SET_UP')
  }

  // Routing still applies, but only accounts whose grant carries the app data
  // scope can hold a vault file at all.
  const decision = await selectAccount(userId, sizeBytes)
  const account = accountHasVaultScope(decision.account)
    ? decision.account
    : decision.candidates.map((c) => c.account).find(accountHasVaultScope)

  if (!account) {
    return fail(
      409,
      'No drive has granted access to its app data folder yet. Reconnect a drive to enable the vault.',
      'VAULT_SCOPE_REQUIRED',
    )
  }

  // Google sees only this. It reveals nothing about the file.
  const opaqueName = randomToken(16)
  const uploadUrl = await createVaultUploadSession(account, { name: opaqueName, sizeBytes }, env.APP_URL)

  const session = await prisma.uploadSession.create({
    data: {
      userId,
      accountId: account.id,
      fileName: opaqueName,
      mimeType: 'application/octet-stream',
      sizeBytes,
      uploadUrl,
      status: 'uploading',
      expiresAt: new Date(Date.now() + 6 * 86400_000),
    },
  })

  return NextResponse.json(
    { sessionId: session.id, uploadUrl, account: { id: account.id, email: account.email } },
    { status: 201 },
  )
})
