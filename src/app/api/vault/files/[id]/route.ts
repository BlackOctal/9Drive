import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { deleteRemoteFile, syncQuota } from '@/lib/server/providers/google'
import { apiHandler, fail, log } from '@/lib/server/api'

export const runtime = 'nodejs'

/**
 * Deletes a vault file. Permanently — there is no other kind.
 *
 * Files in the app data folder cannot be trashed, so there is no restore path
 * to offer and no soft-delete to fall back on. The UI says so before asking.
 */
export const DELETE = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId()
  const { id } = await params

  const secret = await prisma.secretFile.findFirst({ where: { id, userId }, include: { account: true } })
  if (!secret) return fail(404, 'That file is not in your vault.', 'NOT_FOUND')

  // A file already gone from Drive should still lose its row, so the vault
  // does not keep listing something that cannot be fetched.
  await deleteRemoteFile(secret.account, secret.providerFileId).catch(() => undefined)
  await prisma.secretFile.delete({ where: { id: secret.id } })

  await syncQuota(secret.accountId).catch(() => undefined)
  await log(userId, 'vault.delete', 'secret_file', secret.id)

  return NextResponse.json({ ok: true })
})
