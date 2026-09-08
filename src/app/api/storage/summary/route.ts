import { NextResponse } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { previewRouting } from '@/lib/server/routing/select-account'
import { serializeBytes } from '@/lib/bytes'
import { apiHandler } from '@/lib/server/api'

export const dynamic = 'force-dynamic'

/** Everything the dashboard header needs in one round trip. */
export const GET = apiHandler(async () => {
  const userId = await requireUserId()

  const [accounts, breakdown, fileCount, nextTarget] = await Promise.all([
    prisma.connectedAccount.findMany({ where: { userId, status: 'connected' }, include: { quota: true } }),
    prisma.$queryRaw<Array<{ kind: string; bytes: bigint | null; count: bigint }>>`
      SELECT CASE
               WHEN mime_type LIKE 'image/%' THEN 'image'
               WHEN mime_type LIKE 'video/%' THEN 'video'
               WHEN mime_type LIKE 'audio/%' THEN 'audio'
               WHEN mime_type LIKE 'application/zip'
                 OR mime_type LIKE 'application/x-%' THEN 'archive'
               ELSE 'document'
             END AS kind,
             COALESCE(SUM(size_bytes), 0) AS bytes,
             COUNT(*) AS count
      FROM files
      WHERE user_id = ${userId} AND status = 'active'
      GROUP BY kind
    `,
    prisma.file.count({ where: { userId, status: 'active' } }),
    previewRouting(userId),
  ])

  const totals = accounts.reduce(
    (acc, a) => {
      acc.totalBytes += a.quota?.totalBytes ?? 0n
      acc.usedBytes += a.quota?.usedBytes ?? 0n
      acc.availableBytes += a.quota?.availableBytes ?? 0n
      return acc
    },
    { totalBytes: 0n, usedBytes: 0n, availableBytes: 0n },
  )

  return NextResponse.json({
    totalBytes: serializeBytes(totals.totalBytes),
    usedBytes: serializeBytes(totals.usedBytes),
    availableBytes: serializeBytes(totals.availableBytes),
    accountCount: accounts.length,
    fileCount,
    nextTarget,
    breakdown: breakdown.map((row) => ({
      kind: row.kind,
      bytes: serializeBytes(row.bytes ?? 0n),
      count: Number(row.count),
    })),
  })
})
