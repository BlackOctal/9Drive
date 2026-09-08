import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { serializeBytes } from '@/lib/bytes'
import { syncQuota } from '@/lib/server/providers/google'
import { apiHandler, fail, log } from '@/lib/server/api'

export const runtime = 'nodejs'

const schema = z.object({
  sessionId: z.string().min(1),
  providerFileId: z.string().min(1).optional(),
  /** All three are AES-GCM blobs produced in the browser. */
  encryptedName: z.string().min(1).max(4096).optional(),
  encryptedFileKey: z.string().min(1).max(1024).optional(),
  iv: z.string().min(1).max(64).optional(),
  failed: z.boolean().optional(),
  error: z.string().max(500).optional(),
})

/**
 * Phase two: records the finished vault file.
 *
 * The row it writes is ciphertext and wrapped key material. Nothing here can
 * be read without the passphrase, including by us.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const userId = await requireUserId()
  const body = schema.parse(await req.json())

  const session = await prisma.uploadSession.findFirst({ where: { id: body.sessionId, userId } })
  if (!session || !session.accountId) return fail(404, 'That upload is not in progress.', 'NOT_FOUND')

  if (body.failed) {
    await prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'failed', errorMessage: body.error?.slice(0, 500) ?? 'Upload failed' },
    })
    return NextResponse.json({ ok: true })
  }

  if (!body.providerFileId || !body.encryptedName || !body.encryptedFileKey || !body.iv) {
    return fail(400, 'A finished vault upload needs its encrypted metadata.', 'INVALID')
  }
  if (session.status === 'completed') return fail(409, 'That upload was already recorded.', 'ALREADY_DONE')

  const secret = await prisma.secretFile.create({
    data: {
      userId,
      accountId: session.accountId,
      providerFileId: body.providerFileId,
      encryptedName: body.encryptedName,
      encryptedFileKey: body.encryptedFileKey,
      iv: body.iv,
      sizeBytes: session.sizeBytes,
    },
  })

  await prisma.uploadSession.update({
    where: { id: session.id },
    data: { status: 'completed', completedAt: new Date() },
  })

  // Vault files consume the account's quota like anything else, so the volume
  // reading has to move.
  await syncQuota(session.accountId).catch(() => undefined)
  // Deliberately no filename in the log: it is the thing being protected.
  await log(userId, 'vault.upload', 'secret_file', secret.id, { bytes: secret.sizeBytes.toString() })

  return NextResponse.json(
    { id: secret.id, sizeBytes: serializeBytes(secret.sizeBytes), createdAt: secret.createdAt.toISOString() },
    { status: 201 },
  )
})
