import { NextResponse } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { env } from '@/lib/server/env'
import { requireUserId } from '@/lib/server/session'
import { readBays } from '@/lib/server/bays'
import { previewRouting } from '@/lib/server/routing/select-account'
import { serializeBytes } from '@/lib/bytes'
import { apiHandler } from '@/lib/server/api'

export const dynamic = 'force-dynamic'

/**
 * The whole array in one reading.
 *
 * The dashboard presents pooled storage as a single volume, so the totals are
 * summed here rather than left for the client to add up — the client should
 * never have to know the volume is really nine drives to render it.
 */
export const GET = apiHandler(async () => {
  const userId = await requireUserId()

  const [bays, breakdown, fileCount, nextTarget, recentUploads] = await Promise.all([
    readBays(userId),
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
    prisma.uploadSession.count({
      where: { userId, status: 'completed', completedAt: { gte: new Date(Date.now() - 86400_000) } },
    }),
  ])

  // Only healthy bays count toward capacity. A degraded drive's space is not
  // usable, and showing it in the total would overstate what the volume holds.
  const online = bays.filter((b) => b.state === 'online')
  const totalBytes = online.reduce((sum, b) => sum + BigInt(b.totalBytes ?? 0), 0n)
  const usedBytes = bays.reduce((sum, b) => sum + BigInt(b.usedBytes ?? 0), 0n)

  return NextResponse.json({
    volume: {
      totalBytes: serializeBytes(totalBytes),
      usedBytes: serializeBytes(usedBytes),
      availableBytes: serializeBytes(totalBytes > usedBytes ? totalBytes - usedBytes : 0n),
      fileCount,
      uploadsToday: recentUploads,
    },
    bays,
    chassisSize: env.MAX_DRIVE_BAYS,
    onlineCount: online.length,
    degradedCount: bays.filter((b) => b.state === 'degraded').length,
    nextTarget,
    breakdown: breakdown.map((row) => ({
      kind: row.kind,
      bytes: serializeBytes(row.bytes ?? 0n),
      count: Number(row.count),
    })),
  })
})
