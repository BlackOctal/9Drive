import { NextResponse } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { serializeBytes } from '@/lib/bytes'
import { apiHandler } from '@/lib/server/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async () => {
  const userId = await requireUserId()
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId },
    include: { quota: true, _count: { select: { files: { where: { status: 'active' } }, secretFiles: true } } },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({
    accounts: accounts.map((a) => ({
      id: a.id,
      bayIndex: a.bayIndex,
      provider: a.provider,
      email: a.email,
      displayName: a.displayName,
      avatarUrl: a.avatarUrl,
      status: a.status,
      lastError: a.lastError,
      fileCount: a._count.files,
      // Disconnecting cascades these rows away, and with them the wrapped keys
      // that make the ciphertext on Drive readable. The UI has to say so.
      secretFileCount: a._count.secretFiles,
      connectedAt: a.createdAt.toISOString(),
      quota: {
        totalBytes: serializeBytes(a.quota?.totalBytes ?? null),
        usedBytes: serializeBytes(a.quota?.usedBytes ?? 0n),
        availableBytes: serializeBytes(a.quota?.availableBytes ?? null),
        trashBytes: serializeBytes(a.quota?.trashBytes ?? null),
        lastSyncedAt: a.quota?.lastSyncedAt?.toISOString() ?? null,
      },
    })),
  })
})
