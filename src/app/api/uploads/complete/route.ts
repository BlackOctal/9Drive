import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { getFileMetadata, syncQuota } from '@/lib/server/providers/google'
import { serializeBytes } from '@/lib/bytes'
import { apiHandler, fail, log } from '@/lib/server/api'

export const runtime = 'nodejs'

const schema = z.object({
  sessionId: z.string().min(1),
  providerFileId: z.string().min(1).optional(),
  failed: z.boolean().optional(),
  error: z.string().max(1000).optional(),
})

/**
 * Phase two. The browser reports back once Google has accepted the last chunk.
 *
 * The claimed file id is verified against Drive rather than trusted, so a
 * forged call cannot mint a pointer to somebody else's file.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const userId = await requireUserId()
  const body = schema.parse(await req.json())

  const session = await prisma.uploadSession.findFirst({
    where: { id: body.sessionId, userId },
    include: { account: true },
  })
  if (!session) return fail(404, 'That upload session has expired.', 'NO_SESSION')

  if (body.failed || !body.providerFileId) {
    await prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'failed', errorMessage: body.error?.slice(0, 500) ?? 'Upload did not finish.' },
    })
    return NextResponse.json({ ok: false })
  }

  if (!session.account) return fail(409, 'The destination account was disconnected mid-upload.', 'ACCOUNT_GONE')

  const remote = await getFileMetadata(session.account, body.providerFileId)

  const file = await prisma.file.upsert({
    where: { accountId_providerFileId: { accountId: session.account.id, providerFileId: remote.id } },
    create: {
      userId,
      accountId: session.account.id,
      folderId: session.folderId,
      provider: 'google_drive',
      providerFileId: remote.id,
      name: remote.name ?? session.fileName,
      mimeType: remote.mimeType ?? session.mimeType,
      sizeBytes: remote.size ? BigInt(remote.size) : session.sizeBytes,
      status: 'active',
    },
    update: { status: 'active', deletedAt: null },
  })

  await prisma.uploadSession.update({
    where: { id: session.id },
    data: { status: 'completed', completedAt: new Date() },
  })

  await log(userId, 'file.upload', 'file', file.id, {
    name: file.name,
    bytes: file.sizeBytes.toString(),
    account: session.account.email,
  })

  // Refresh the ledger so the next routing decision sees the new usage.
  await syncQuota(session.account.id)

  return NextResponse.json({
    ok: true,
    file: { ...file, sizeBytes: serializeBytes(file.sizeBytes) },
  })
})
