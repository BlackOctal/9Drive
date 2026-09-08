import { NextResponse } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { serializeBytes } from '@/lib/bytes'
import { accountHasVaultScope, listAppDataFiles } from '@/lib/server/providers/google'
import { apiHandler } from '@/lib/server/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The vault's whole server-side state.
 *
 * Everything here is ciphertext or public parameters. The salt is not a
 * secret — it exists so one passphrase does not derive one key for everybody
 * — and the verifier is only useful to someone who already knows the
 * passphrase. Names arrive encrypted and are decrypted in the browser.
 */
export const GET = apiHandler(async () => {
  const userId = await requireUserId()

  const [user, accounts, files] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { vaultSalt: true, vaultVerifier: true } }),
    prisma.connectedAccount.findMany({ where: { userId }, orderBy: { bayIndex: 'asc' } }),
    prisma.secretFile.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ])

  // The app data scope was added after the first drives were connected, so an
  // older grant simply does not carry it. Naming the drives lets the UI ask
  // for a reconnect instead of surfacing a raw 403 from Google later.
  const needsReconnect = accounts
    .filter((a) => !accountHasVaultScope(a))
    .map((a) => ({ id: a.id, email: a.email, bayIndex: a.bayIndex }))

  const ready = accounts.filter((a) => a.status === 'connected' && accountHasVaultScope(a))

  // A file whose account no longer holds it has been deleted out of band, or
  // the app data folder was wiped by disconnecting 9Drive from the account.
  // Both are unrecoverable, and both should be visible rather than silent.
  const listedByAccount = new Map<string, Set<string>>()
  await Promise.all(
    [...new Set(files.map((f) => f.accountId))].map(async (accountId) => {
      const account = ready.find((a) => a.id === accountId)
      if (!account) return
      try {
        const entries = await listAppDataFiles(account)
        listedByAccount.set(accountId, new Set(entries.map((e) => e.id)))
      } catch {
        // Could not read it; say nothing rather than report a false loss.
      }
    }),
  )

  return NextResponse.json({
    configured: Boolean(user.vaultSalt && user.vaultVerifier),
    salt: user.vaultSalt,
    verifier: user.vaultVerifier,
    readyDriveCount: ready.length,
    needsReconnect,
    files: files.map((f) => ({
      id: f.id,
      encryptedName: f.encryptedName,
      encryptedFileKey: f.encryptedFileKey,
      iv: f.iv,
      sizeBytes: serializeBytes(f.sizeBytes),
      createdAt: f.createdAt.toISOString(),
      present: listedByAccount.has(f.accountId)
        ? listedByAccount.get(f.accountId)!.has(f.providerFileId)
        : true,
    })),
  })
})
